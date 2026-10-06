import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { FakeD1 } from './fake-d1.js';

const TEAM_KEY = 'secret-key';
const env = { DB: new FakeD1(), TEAM_KEY };

function request(pathname, { method = 'GET', body, key = TEAM_KEY, rawBody, targetEnv = env } = {}) {
  const headers = {};
  if (key) headers['X-Team-Key'] = key;
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
  const req = new Request(`https://articledepot.example.workers.dev${pathname}`, {
    method,
    headers,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return worker.fetch(req, targetEnv);
}

test('rejects API requests without the right team key', async () => {
  assert.equal((await request('/api/articles', { key: '' })).status, 401);
  assert.equal((await request('/api/articles', { key: 'nope' })).status, 401);
});

test('refuses to run without a TEAM_KEY secret', async () => {
  const res = await request('/api/articles', { targetEnv: { DB: new FakeD1() } });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /TEAM_KEY/);
});

test('answers CORS preflight for the extension', async () => {
  const res = await request('/api/articles', { method: 'OPTIONS', key: '' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-headers'), /X-Team-Key/);
});

test('includes CORS headers on errors too', async () => {
  const res = await request('/api/articles', { key: 'nope' });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('adds, lists, updates and removes articles', async () => {
  const create = await request('/api/articles', {
    method: 'POST',
    body: {
      url: 'https://example.com/story',
      title: 'A remarkable story',
      siteName: 'Example',
      flaggedBy: 'Jordan',
      category: 'option',
      notes: 'Rights holder is the author',
    },
  });
  assert.equal(create.status, 201);
  const { article } = await create.json();
  assert.equal(article.flaggedBy, 'Jordan');
  assert.equal(article.siteName, 'Example');
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
  assert.equal(updated.title, 'A remarkable story');

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

test('lists newest first', async () => {
  const targetEnv = { DB: new FakeD1(), TEAM_KEY };
  for (const n of [1, 2, 3]) {
    await request('/api/articles', {
      method: 'POST',
      targetEnv,
      body: { url: `https://example.com/${n}`, flaggedBy: 'A', category: 'option' },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const { articles } = await (await request('/api/articles', { targetEnv })).json();
  assert.deepEqual(articles.map((a) => a.url), [3, 2, 1].map((n) => `https://example.com/${n}`));
});

test('validates input', async () => {
  const cases = [
    { url: 'not a url', flaggedBy: 'A', category: 'option' },
    { url: 'javascript:alert(1)', flaggedBy: 'A', category: 'option' },
    { url: 'https://example.com', flaggedBy: '', category: 'option' },
    { url: 'https://example.com', flaggedBy: 'A', category: 'maybe' },
    { url: 'https://example.com', flaggedBy: 42, category: 'option' },
    { url: 'https://example.com', flaggedBy: 'A', category: 'option', notes: 'x'.repeat(5001) },
  ];
  for (const body of cases) {
    const res = await request('/api/articles', { method: 'POST', body });
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
  }
  const notJson = await request('/api/articles', { method: 'POST', rawBody: '[1,2' });
  assert.equal(notJson.status, 400);
  const tooBig = await request('/api/articles', { method: 'POST', rawBody: JSON.stringify({ x: 'y'.repeat(70000) }) });
  assert.equal(tooBig.status, 413);
});

test('returns 404 for unknown articles and paths', async () => {
  const res = await request('/api/articles/does-not-exist', { method: 'PATCH', body: { notes: 'x' } });
  assert.equal(res.status, 404);
  assert.equal((await request('/api/articles/nope', { method: 'DELETE' })).status, 404);
  assert.equal((await request('/api/other')).status, 404);
});
