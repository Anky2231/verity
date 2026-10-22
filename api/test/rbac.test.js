import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

process.env.REDIS_URL = '';

let server, base;
test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const login = async (role) =>
  (await (await fetch(`${base}/auth/demo-login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }),
  })).json()).token;

const get = (path, token) =>
  fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

test('health is public', async () => assert.equal((await get('/health')).status, 200));
test('no token -> 401', async () => assert.equal((await get('/manager/queue')).status, 401));
test('creator cannot call manager endpoint -> 403', async () =>
  assert.equal((await get('/manager/queue', await login('creator'))).status, 403));
test('manager can call manager endpoint', async () =>
  assert.equal((await get('/manager/queue', await login('manager'))).status, 200));
test('manager cannot call approver endpoint -> 403', async () =>
  assert.equal((await get('/approver/escalations', await login('manager'))).status, 403));
test('approver can call approver endpoint', async () =>
  assert.equal((await get('/approver/escalations', await login('approver'))).status, 200));
