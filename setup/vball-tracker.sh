#!/bin/bash
# One-time bootstrap for vball-tracker on Jonas.
# CI handles all subsequent deploys — only run this once to create the container initially.
# Usage: JONAS_IP=<tailscale-ip> JONAS_PASSWORD=<root-password> ./setup/vball-tracker.sh

set -e

JONAS_IP="${JONAS_IP:?Set JONAS_IP to Jonas's Tailscale IP}"
JONAS_PASSWORD="${JONAS_PASSWORD:?Set JONAS_PASSWORD to Jonas root password}"
SERVICE=vball-tracker
HOST_PORT=3000
DATA_DIR=/mnt/user/appdata/${SERVICE}
ENV_FILE=${DATA_DIR}/.env

ssh_cmd() {
  sshpass -p "${JONAS_PASSWORD}" ssh -o StrictHostKeyChecking=no root@"${JONAS_IP}" "$@"
}

echo "==> Checking prerequisites on Jonas..."

# Verify .env exists on Jonas with required vars
MISSING=$(ssh_cmd "
  missing=''
  for var in PARTIFUL_REFRESH_TOKEN FIREBASE_API_KEY; do
    grep -q \"^\${var}=\" ${ENV_FILE} 2>/dev/null || missing=\"\$missing \$var\"
  done
  echo \$missing
")
if [ -n "$MISSING" ]; then
  echo "ERROR: Missing env vars in ${ENV_FILE} on Jonas:${MISSING}"
  echo "Create ${ENV_FILE} on Jonas with these vars set, then re-run."
  exit 1
fi

echo "==> Checking if container already exists..."
RUNNING=$(ssh_cmd "docker ps -q --filter name=^/${SERVICE}$" || true)
if [ -n "$RUNNING" ]; then
  echo "Container '${SERVICE}' is already running. CI will handle future deploys. Exiting."
  exit 0
fi

echo "==> Creating data directory..."
ssh_cmd "mkdir -p ${DATA_DIR}"

echo "==> NOTE: This script requires the image to already exist in the Zot registry."
echo "    Trigger a push to main to build and push the image first, then re-run this script."

IMAGE="${JONAS_IP}:5000/${SERVICE}:latest"

# Check image is available
ssh_cmd "docker pull ${IMAGE}" || {
  echo "ERROR: Could not pull ${IMAGE}. Push to main to build the image first."
  exit 1
}

echo "==> Starting ${SERVICE}..."
ssh_cmd "docker run -d --name ${SERVICE} --restart unless-stopped \
  -p ${HOST_PORT}:3000 \
  -v ${DATA_DIR}:/data \
  --env-file ${ENV_FILE} \
  ${IMAGE}"

echo "==> Verifying container is running..."
sleep 3
STATUS=$(ssh_cmd "docker inspect --format='{{.State.Status}}' ${SERVICE}" || echo "missing")
if [ "$STATUS" != "running" ]; then
  echo "ERROR: Container status is '${STATUS}'. Check logs: ssh root@${JONAS_IP} docker logs ${SERVICE}"
  exit 1
fi

echo "==> Smoke test (http://localhost:${HOST_PORT})..."
ssh_cmd "curl -sf http://localhost:${HOST_PORT} -o /dev/null" && echo "OK" || echo "WARNING: curl failed — app may still be starting up"

echo ""
echo "Done! vball-tracker is running on Jonas at http://${JONAS_IP}:${HOST_PORT}"
echo "Subsequent deploys happen automatically on push to main."
