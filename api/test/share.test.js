import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';
import { seedHistory } from '../src/seed-history.js';

process.env.REDIS_URL = '';
let server, base, db;
const tokens = {};
test.before(async () => {
  db = await freshDb(); await seed(db); await seedHistory(db);
  server = createApp({ db, log: { enabled: () => false } }).listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.close(); });

async function call(role, brand, method, path, body, authed = true) {
  if (authed) tokens[role] ??= (await (await fetch(`${base}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })).json()).token;
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(authed ? { authorization: `Bearer ${tokens[role]}` } : {}), ...(brand ? { 'x-brand-id': brand } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const publicReport = (token) => call(null, null, 'GET', `/public/report/${token}`, undefined, false);

test('only managers and admins can create, list or revoke report links', async () => {
  assert.equal((await call('creator', 'lumina', 'POST', '/share-links', {})).status, 403, 'Maya is a creator at Lumina');
  assert.equal((await call('approver', 'lumina', 'POST', '/share-links', {})).status, 403);
  assert.equal((await call('creator', 'lumina', 'GET', '/share-links')).status, 403);
  assert.equal((await call('creator', 'lumina', 'DELETE', '/share-links/1')).status, 403);
  assert.equal((await call('manager', 'lumina', 'POST', '/share-links', { label: 'Acme review' })).status, 201);
});

test('a link opens the report without signing in, and the report holds no names or text', async () => {
  const made = (await call('manager', 'lumina', 'POST', '/share-links', { days: 7, label: 'Client' })).body;
  assert.ok(made.token.length >= 30 && made.path === `/report?token=${made.token}`);
  const res = await publicReport(made.token);
  assert.equal(res.status, 200);
  assert.equal(res.body.brand, 'Lumina Coffee Co.');
  assert.ok(res.body.reviews_total > 10 && res.body.reviews.length > 0 && res.body.top_clauses.length > 0);
  const text = JSON.stringify(res.body);
  for (const secret of ['Maya', 'Rajan', 'Anita', 'u_maya', 'internal note', '"text"', '"comments"', '"actor']) assert.ok(!text.includes(secret), `report must not contain ${secret}`);
});

test('the token is stored only as a hash and is never listed again', async () => {
  const made = (await call('manager', 'lumina', 'POST', '/share-links', {})).body;
  const rows = await db.query('SELECT token_hash FROM share_links WHERE id=$1', [made.id]);
  assert.notEqual(rows[0].token_hash, made.token);
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
  const list = (await call('manager', 'lumina', 'GET', '/share-links')).body;
  assert.ok(list.some((l) => l.id === made.id && l.active === true));
  assert.ok(!JSON.stringify(list).includes(made.token));
});

test('a link only ever shows the brand it was made for', async () => {
  const l = (await call('manager', 'lumina', 'POST', '/share-links', {})).body;
  const n = (await call('creator', 'northwind', 'POST', '/share-links', {})).body;   // Maya manages Northwind
  assert.equal((await publicReport(l.token)).body.brand, 'Lumina Coffee Co.');
  assert.equal((await publicReport(n.token)).body.brand, 'Northwind Tea Co.');
  assert.ok((await publicReport(n.token)).body.reviews_total < (await publicReport(l.token)).body.reviews_total);
});

test('wrong, expired and revoked tokens all get the same 404', async () => {
  const made = (await call('manager', 'lumina', 'POST', '/share-links', {})).body;
  const wrong = await publicReport('definitely-not-valid');
  await db.query(`UPDATE share_links SET expires_at = now() - interval '1 minute' WHERE id=$1`, [made.id]);
  const expired = await publicReport(made.token);
  const other = (await call('manager', 'lumina', 'POST', '/share-links', {})).body;
  assert.equal((await call('manager', 'lumina', 'DELETE', `/share-links/${other.id}`)).status, 200);
  const revoked = await publicReport(other.token);
  for (const r of [wrong, expired, revoked]) { assert.equal(r.status, 404); assert.deepEqual(r.body, { error: 'not_found' }); }
});

test('another brand cannot revoke a link, and revoking twice is a 404', async () => {
  const l = (await call('manager', 'lumina', 'POST', '/share-links', {})).body;
  assert.equal((await call('creator', 'northwind', 'DELETE', `/share-links/${l.id}`)).status, 404, 'Maya manages Northwind, not Lumina');
  assert.equal((await publicReport(l.token)).status, 200);
  assert.equal((await call('manager', 'lumina', 'DELETE', `/share-links/${l.id}`)).status, 200);
  assert.equal((await call('manager', 'lumina', 'DELETE', `/share-links/${l.id}`)).status, 404);
});

test('days and label are validated', async () => {
  for (const days of [0, 91, 1.5, 'x']) assert.equal((await call('manager', 'lumina', 'POST', '/share-links', { days })).body.error, 'invalid_days', String(days));
  assert.equal((await call('manager', 'lumina', 'POST', '/share-links', { label: 'x'.repeat(101) })).body.error, 'invalid_label');
});

test('creating and revoking a link is written to the audit trail, and the chain still verifies', async () => {
  const l = (await call('manager', 'lumina', 'POST', '/share-links', {})).body;
  await call('manager', 'lumina', 'DELETE', `/share-links/${l.id}`);
  const actions = (await call('manager', 'lumina', 'GET', '/audit')).body.map((r) => r.action);
  assert.ok(actions.includes('share.created') && actions.includes('share.revoked'));
  assert.equal((await call('manager', 'lumina', 'GET', '/audit/verify')).body.ok, true);
});

test('the public report is rate limited per address', async () => {
  let last;
  for (let i = 0; i < 61; i++) last = await publicReport('x');
  assert.equal(last.status, 429);
});
