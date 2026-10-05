'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store, ValidationError, CATEGORIES } = require('./store');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 64 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error('not an object');
        }
        resolve(body);
      } catch {
        reject(new HttpError(400, 'Request body must be a JSON object'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream',
    });
    res.end(data);
  });
}

function createServer({ dataFile, teamKey = '' }) {
  const store = new Store(dataFile);

  async function handleApi(req, res, pathname) {
    if (teamKey && !safeEqual(req.headers['x-team-key'] || '', teamKey)) {
      throw new HttpError(401, 'Missing or incorrect team key');
    }

    if (pathname === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, { categories: CATEGORIES });
    }

    if (pathname === '/api/articles') {
      if (req.method === 'GET') return sendJson(res, 200, { articles: store.list() });
      if (req.method === 'POST') {
        const { article, created } = store.add(await readJsonBody(req));
        return sendJson(res, created ? 201 : 200, { article, created });
      }
      throw new HttpError(405, 'Method not allowed');
    }

    const match = pathname.match(/^\/api\/articles\/([\w-]+)$/);
    if (match) {
      const id = match[1];
      if (req.method === 'PATCH') {
        const article = store.update(id, await readJsonBody(req));
        if (!article) throw new HttpError(404, 'Article not found');
        return sendJson(res, 200, { article });
      }
      if (req.method === 'DELETE') {
        if (!store.remove(id)) throw new HttpError(404, 'Article not found');
        res.writeHead(204);
        return res.end();
      }
      throw new HttpError(405, 'Method not allowed');
    }

    throw new HttpError(404, 'Not found');
  }

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname.startsWith('/api/')) {
      // The browser extension calls the API from its own origin, so allow CORS.
      // Access is still controlled by the team key when one is configured.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Team-Key');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      try {
        await handleApi(req, res, pathname);
      } catch (err) {
        if (err instanceof ValidationError) return sendJson(res, 400, { error: err.message });
        if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
        console.error(err);
        sendJson(res, 500, { error: 'Internal server error' });
      }
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    serveStatic(req, res, pathname);
  });

  return { server, store };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const dataFile = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'articles.json');
  const teamKey = process.env.TEAM_KEY || '';
  const { server } = createServer({ dataFile, teamKey });
  server.listen(port, () => {
    console.log(`Article Depot running at http://localhost:${port}`);
    console.log(`Storing articles in ${dataFile}`);
    if (!teamKey) {
      console.log('Warning: TEAM_KEY is not set, so anyone who can reach this server can read and edit articles.');
    }
  });
}

module.exports = { createServer };
