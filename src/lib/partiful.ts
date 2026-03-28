import { deserializeGuest, type Guest } from './firestore';

const BASE_URL = 'https://api.partiful.com';

function getToken(): string {
  const token = process.env.PARTIFUL_AUTH_TOKEN;
  if (!token) throw new Error('PARTIFUL_AUTH_TOKEN not set in .env');
  return token;
}

function decodeUserId(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return payload.user_id;
}

async function post(endpoint: string, params: Record<string, unknown> = {}) {
  const token = getToken();
  const userId = decodeUserId(token);

  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://partiful.com',
    },
    body: JSON.stringify({
      data: {
        params,
        amplitudeDeviceId: 'vball-tracker',
        amplitudeSessionId: Date.now(),
        userId,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${endpoint} → ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function getCreatedEvents() {
  return post('getCreatedCards');
}

export async function getUpcomingEvents() {
  return post('getMyUpcomingEventsForHomePage');
}

export async function getPastEvents() {
  return post('getMyPastEventsForHomePage');
}

export async function getEventPermission(eventId: string) {
  return post('getEventPermission', { eventId });
}

export async function getContacts() {
  const token = getToken();
  const res = await fetch(`${BASE_URL}/getContacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://partiful.com',
    },
    body: JSON.stringify({
      data: {
        params: {},
        paging: { maxResults: 1000, cursor: null },
        amplitudeDeviceId: 'vball-tracker',
        amplitudeSessionId: Date.now(),
        userId: decodeUserId(token),
      },
    }),
  });
  if (!res.ok) throw new Error(`getContacts → ${res.status}`);
  return res.json();
}

export async function getUsers(ids: string[]) {
  return post('getUsers', { ids, includePartyStats: false });
}

// --- Firestore REST API ---
// Same Bearer token works. Project: getpartiful

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/getpartiful/databases/(default)/documents';

async function firestoreBatchGet(docPaths: string[]) {
  const token = getToken();
  const documents = docPaths.map(p => `projects/getpartiful/databases/(default)/documents/${p}`);
  const res = await fetch(`${FIRESTORE_BASE}:batchGet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://partiful.com',
      'x-firebase-gmpid': '1:939741910890:web:5cca435c4b26209b8a7713',
    },
    body: JSON.stringify({ documents }),
  });
  if (!res.ok) throw new Error(`firestoreBatchGet → ${res.status}`);
  return res.json();
}

async function firestoreQuery(collectionPath: string, query: Record<string, unknown>) {
  const token = getToken();
  const res = await fetch(`${FIRESTORE_BASE}/${collectionPath}:runQuery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://partiful.com',
      'x-firebase-gmpid': '1:939741910890:web:5cca435c4b26209b8a7713',
    },
    body: JSON.stringify({ structuredQuery: query }),
  });
  if (!res.ok) throw new Error(`firestoreQuery → ${res.status}`);
  return res.json();
}

export async function getMyUserDoc() {
  const userId = decodeUserId(getToken());
  return firestoreBatchGet([`users/${userId}`]);
}

export async function getEventGuests(eventId: string): Promise<Guest[]> {
  const raw = await firestoreQuery(`events/${eventId}`, { from: [{ collectionId: 'guests' }] });
  return raw.filter((r: any) => r.document).map(deserializeGuest);
}
