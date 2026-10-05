'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server/server');

let tmpDir;
let base;
let server;
const TEAM_KEY = 'secret-key';

function request(pathname, { method = 'GET', body, key = TEAM_KEY } = {}) {
  const headers = {};
  if (key) headers['X-Team-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(base + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'articledepot-'));
  ({ server } = createServer({ dataFile: path.join(tmpDir, 'articles.json'), teamKey: TEAM_KEY }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('rejects API requests without the team key', async () => {
  const res = await request('/api/articles', { key: '' });
  assert.equal(res.status, 401);
  const wrong = await request('/api/articles', { key: 'nope' });
  assert.equal(wrong.status, 401);
});

test('serves the dashboard without a key', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Article Depot/);
});

test('does not serve files outside the public folder', async () => {
  const res = await fetch(`${base}/..%2fstore.js`);
  assert.equal(res.status, 404);
});

test('answers CORS preflight for the extension', async () => {
  const res = await fetch(`${base}/api/articles`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-headers'), /X-Team-Key/);
});

test('adds, lists, updates and removes articles', async () => {
  const create = await request('/api/articles', {
    method: 'POST',
    body: {
      url: 'https://example.com/story',
      title: 'A remarkable story',
      flaggedBy: 'Jordan',
      category: 'option',
      notes: 'Rights holder is the author',
    },
  });
  assert.equal(create.status, 201);
  const { article } = await create.json();
  assert.equal(article.flaggedBy, 'Jordan');
  assert.equal(article.category, 'option');

  const list = await (await request('/api/articles')).json();
  assert.equal(list.articles.length, 1);

  const patch = await request(`/api/articles/${article.id}`, {
    method: 'PATCH',
    body: { category: 'inspiration', notes: 'Better as inspiration' },
  });
  assert.equal(patch.status, 200);
  const updated = (await patch.json()).article;
  assert.equal(updated.category, 'inspiration');
  assert.equal(updated.notes, 'Better as inspiration');

  const del = await request(`/api/articles/${article.id}`, { method: 'DELETE' });
  assert.equal(del.status, 204);
  const after = await (await request('/api/articles')).json();
  assert.equal(after.articles.length, 0);
});

test('re-flagging the same URL by the same person updates instead of duplicating', async () => {
  const body = { url: 'https://example.com/dup', flaggedBy: 'Sam', category: 'pass' };
  assert.equal((await request('/api/articles', { method: 'POST', body })).status, 201);
  const again = await request('/api/articles', {
    method: 'POST',
    body: { ...body, flaggedBy: 'sam', category: 'option' },
  });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).article.category, 'option');

  // A different person flagging the same link gets their own entry.
  const other = await request('/api/articles', { method: 'POST', body: { ...body, flaggedBy: 'Alex' } });
  assert.equal(other.status, 201);

  const list = await (await request('/api/articles')).json();
  assert.equal(list.articles.filter((a) => a.url === 'https://example.com/dup').length, 2);
});

test('validates input', async () => {
  const cases = [
    { url: 'not a url', flaggedBy: 'A', category: 'option' },
    { url: 'javascript:alert(1)', flaggedBy: 'A', category: 'option' },
    { url: 'https://example.com', flaggedBy: '', category: 'option' },
    { url: 'https://example.com', flaggedBy: 'A', category: 'maybe' },
    { url: 'https://example.com', flaggedBy: 42, category: 'option' },
  ];
  for (const body of cases) {
    const res = await request('/api/articles', { method: 'POST', body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const notJson = await fetch(`${base}/api/articles`, {
    method: 'POST',
    headers: { 'X-Team-Key': TEAM_KEY, 'Content-Type': 'application/json' },
    body: '[1,2',
  });
  assert.equal(notJson.status, 400);
});

test('returns 404 for unknown articles', async () => {
  const res = await request('/api/articles/does-not-exist', { method: 'PATCH', body: { notes: 'x' } });
  assert.equal(res.status, 404);
});

test('persists articles across restarts', async () => {
  const file = path.join(tmpDir, 'persist.json');
  const first = createServer({ dataFile: file });
  first.store.add({ url: 'https://example.com/keep', flaggedBy: 'Lee', category: 'inspiration' });
  const second = createServer({ dataFile: file });
  assert.equal(second.store.list().length, 1);
  assert.equal(second.store.list()[0].flaggedBy, 'Lee');
});
