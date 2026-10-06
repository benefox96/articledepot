// Article Depot API, running as a Cloudflare Worker. The shared page in
// public/ is served by Cloudflare directly; only /api/* requests reach this code.

import { Store, ValidationError, CATEGORIES } from './store.js';

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS = {
  // The browser extension calls the API from its own origin, so allow CORS.
  // Access is still controlled by the team key.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Team-Key',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Compares hashes so the time taken doesn't reveal how much of the key was right.
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

async function readJsonBody(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new HttpError(413, 'Request body too large');
  }
  if (!text) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  return body;
}

// Reuse one Store per database so the schema check runs once per Worker instance.
const stores = new WeakMap();
function storeFor(db) {
  if (!stores.has(db)) stores.set(db, new Store(db));
  return stores.get(db);
}

async function handleApi(request, env, pathname) {
  if (!env.TEAM_KEY) {
    throw new HttpError(503, 'Article Depot is not set up yet: add a TEAM_KEY secret to the Worker.');
  }
  if (!(await safeEqual(request.headers.get('X-Team-Key') || '', env.TEAM_KEY))) {
    throw new HttpError(401, 'Missing or incorrect team key');
  }

  const store = storeFor(env.DB);

  if (pathname === '/api/config' && request.method === 'GET') {
    return json(200, { categories: CATEGORIES });
  }

  if (pathname === '/api/articles') {
    if (request.method === 'GET') return json(200, { articles: await store.list() });
    if (request.method === 'POST') {
      const { article, created } = await store.add(await readJsonBody(request));
      return json(created ? 201 : 200, { article, created });
    }
    throw new HttpError(405, 'Method not allowed');
  }

  const match = pathname.match(/^\/api\/articles\/([\w-]+)$/);
  if (match) {
    const id = match[1];
    if (request.method === 'PATCH') {
      const article = await store.update(id, await readJsonBody(request));
      if (!article) throw new HttpError(404, 'Article not found');
      return json(200, { article });
    }
    if (request.method === 'DELETE') {
      if (!(await store.remove(id))) throw new HttpError(404, 'Article not found');
      return json(204);
    }
    throw new HttpError(405, 'Method not allowed');
  }

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (!pathname.startsWith('/api/')) return json(404, { error: 'Not found' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    try {
      return await handleApi(request, env, pathname);
    } catch (err) {
      if (err instanceof ValidationError) return json(400, { error: err.message });
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error(err);
      return json(500, { error: 'Internal server error' });
    }
  },
};
