import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';

process.env.REDIS_URL = '';

let server, base, db;
test.before(async () => {
  db = await freshDb(); await seed(db);
  server = createApp({ db }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.close(); });

const login = async (role) =>
  (await (await fetch(`${base}/auth/demo-login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }),
  })).json()).token;

const get = (path, token) =>
  fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

// Staff-only: the analytics summary and the audit trail. Approver/admin-only checks use the same guard on /audit.
test('health is public', async () => assert.equal((await get('/health')).status, 200));
test('no token -> 401', async () => assert.equal((await get('/analytics/summary')).status, 401));
test('a bad token -> 401', async () => assert.equal((await get('/analytics/summary', 'not-a-token')).status, 401));
test('creator cannot read analytics -> 403', async () =>
  assert.equal((await get('/analytics/summary', await login('creator'))).status, 403));
test('creator cannot read the audit trail -> 403', async () =>
  assert.equal((await get('/audit', await login('creator'))).status, 403));
test('manager can read analytics', async () =>
  assert.equal((await get('/analytics/summary', await login('manager'))).status, 200));
test('approver can read the audit trail', async () =>
  assert.equal((await get('/audit', await login('approver'))).status, 200));
test('creator cannot publish a brand guideline -> 403', async () => {
  const res = await fetch(`${base}/brand/publish`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await login('creator')}` }, body: '{}' });
  assert.equal(res.status, 403);
});
test('approver cannot publish a brand guideline -> 403 (managers and admins only)', async () => {
  const res = await fetch(`${base}/brand/publish`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await login('approver')}` }, body: '{}' });
  assert.equal(res.status, 403);
});
