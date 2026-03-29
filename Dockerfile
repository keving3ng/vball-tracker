FROM node:22-alpine AS base
LABEL org.opencontainers.image.vendor="keg"

# Build stage
FROM base AS builder
WORKDIR /app
# VERDACCIO_URL injected by CI (e.g. http://<TAILSCALE_IP>:4873)
# Written here so npm ci inside the container can reach @keg packages.
ARG VERDACCIO_URL
COPY package*.json ./
RUN if [ -n "$VERDACCIO_URL" ]; then \
      echo "@keg:registry=${VERDACCIO_URL}" > .npmrc && \
      echo "//${VERDACCIO_URL#http://}/:_authToken=verdaccio-anonymous" >> .npmrc; \
    fi
RUN npm ci && rm -f .npmrc
COPY . .
RUN npm run build

# Runtime stage
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
