import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load } from 'js-yaml';
import { createApp } from '../src/app.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';

process.env.REDIS_URL = '';
const spec = load(fs.readFileSync(new URL('../../docs/openapi.yaml', import.meta.url), 'utf8'));
let server, base, db;
const tokens = {};
test.before(async () => {
  db = await freshDb(); await seed(db);
  await db.query(`INSERT INTO brands (id, org_id, name) VALUES ('orphan', 'org_demo', 'Nobody Belongs Here') ON CONFLICT DO NOTHING`);
  server = createApp({ db, log: { enabled: () => false } }).listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.close(); });

async function call(role, brand, method, path, body) {
  tokens[role] ??= (await (await fetch(`${base}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })).json()).token;
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[role]}`, ...(brand ? { 'x-brand-id': brand } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('the active brand decides the role: Maya is a creator at Lumina and a manager at Northwind', async () => {
  // Maya's demo login is the "creator" token; the role in each brand comes from her memberships.
  assert.equal((await call('creator', 'lumina', 'GET', '/analytics/summary')).status, 403);
  assert.equal((await call('creator', 'northwind', 'GET', '/analytics/summary')).status, 200);
  assert.equal((await call('manager', 'lumina', 'GET', '/analytics/summary')).status, 200);
  assert.equal((await call('manager', 'northwind', 'GET', '/analytics/summary')).status, 403, 'Rajan is only a creator at Northwind');
});

test('without a brand header the first brand (Lumina) is used', async () => {
  const lumina = await call('creator', undefined, 'POST', '/reviews', { title: 'Default brand' });
  assert.equal(lumina.status, 201); assert.equal(lumina.body.brand_id, 'lumina');
});

test('a brand the user does not belong to, and a brand that does not exist, are the same 403', async () => {
  const notMember = await call('creator', 'orphan', 'GET', '/reviews');
  const missing = await call('creator', 'no-such-brand', 'GET', '/reviews');
  assert.equal(notMember.status, 403); assert.equal(missing.status, 403);
  assert.deepEqual(notMember.body, missing.body, 'the response must not reveal whether the brand exists');
});

test('Brand A data is invisible and untouchable from Brand B, on every route that takes a review id', async () => {
  const mine = (await call('creator', 'lumina', 'POST', '/reviews', { title: 'Lumina secret launch' })).body;
  await call('creator', 'lumina', 'POST', `/reviews/${mine.id}/comments`, { body: 'internal note' });
  const attempts = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!path.includes('{id}')) continue;
    for (const method of ['get', 'post'].filter((m) => item[m])) attempts.push([method.toUpperCase(), path.replace('{id}', mine.id)]);
  }
  assert.ok(attempts.length >= 7, 'the spec lists the review routes');
  for (const [method, path] of attempts) {
    const body = method === 'POST' ? { text: 'hello', decision: 'accepted', flag_key: 'k', revision: 1, body: 'x', action: 'approve' } : undefined;
    const res = await call('creator', 'northwind', method, path.includes('/diff') ? `${path}?from=1&to=1` : path, body);
    assert.equal(res.status, 404, `${method} ${path} from Northwind must be 404, got ${res.status}`);
    assert.equal(res.body?.error, 'not_found');
  }
});

test('lists, audit and analytics only ever show the active brand', async () => {
  const lumina = (await call('creator', 'lumina', 'GET', '/reviews')).body.map((r) => r.id);
  const nw = (await call('creator', 'northwind', 'POST', '/reviews', { title: 'Northwind spring tin' })).body;
  const northwind = (await call('creator', 'northwind', 'GET', '/reviews')).body.map((r) => r.id);
  assert.deepEqual(northwind, [nw.id]);
  assert.ok(!lumina.includes(nw.id) && lumina.length > 0);
  const audit = (await call('manager', 'lumina', 'GET', '/audit')).body;
  assert.ok(audit.every((r) => !r.review_id || lumina.includes(r.review_id)), 'Lumina audit contains no Northwind reviews');
  const nwAudit = (await call('creator', 'northwind', 'GET', '/audit')).body;
  assert.ok(nwAudit.length >= 1 && nwAudit.every((r) => r.review_id === nw.id));
  const sum = (await call('creator', 'northwind', 'GET', '/analytics/summary')).body;
  assert.equal(sum.reviews_total, 1);
});

test('each brand has its own audit chain and both verify', async () => {
  const a = (await call('manager', 'lumina', 'GET', '/audit/verify')).body;
  const b = (await call('creator', 'northwind', 'GET', '/audit/verify')).body;
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.notEqual(a.checked, b.checked);
});

test('guidelines are separate: publishing at Northwind does not touch Lumina versions', async () => {
  const before = (await call('manager', 'lumina', 'GET', '/brand')).body.versions.length;
  const nwBrand = (await call('creator', 'northwind', 'GET', '/brand')).body;
  assert.equal(nwBrand.brand.id, 'northwind');
  assert.ok(nwBrand.current.glossary.some((g) => g.approved === 'tea leaves'));
  const pub = await call('creator', 'northwind', 'POST', '/brand/publish', { big: nwBrand.current });
  assert.equal(pub.status, 201); assert.equal(pub.body.version, 2);
  assert.equal((await call('manager', 'lumina', 'GET', '/brand')).body.versions.length, before);
});

test('a review runs against its own brand guidelines', async () => {
  const seen = [];
  const real = globalThis.fetch;
  process.env.AI_SERVICE_URL = 'http://ai.test';
  globalThis.fetch = (url, init) => {
    if (!String(url).startsWith('http://ai.test')) return real(url, init);
    const b = JSON.parse(init.body); seen.push({ brand: b.brand_id, term: b.big.glossary[0].approved });
    return Promise.resolve(new Response(JSON.stringify({ text: b.text, score: 90, agents: [], highlights: [], timing: {} }), { status: 200 }));
  };
  try {
    const l = (await call('creator', 'lumina', 'POST', '/reviews', { title: 'L' })).body;
    const n = (await call('creator', 'northwind', 'POST', '/reviews', { title: 'N' })).body;
    assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${l.id}/run`, { text: 'Hello coffee' })).status, 200);
    assert.equal((await call('creator', 'northwind', 'POST', `/reviews/${n.id}/run`, { text: 'Hello tea' })).status, 200);
  } finally { globalThis.fetch = real; }
  assert.deepEqual(seen, [{ brand: 'lumina', term: 'coffee beans' }, { brand: 'northwind', term: 'tea leaves' }]);
});

test('notifications and who gets them are per brand', async () => {
  const lReview = (await call('creator', 'lumina', 'POST', '/reviews', { title: 'Notify L' })).body;
  await db.query(`INSERT INTO revisions (review_id, brand_id, number, text, score, result) VALUES ($1,'lumina',1,'t',90,'{"highlights":[]}')`, [lReview.id]);
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${lReview.id}/transition`, { action: 'submit' })).status, 200);
  const rajanLumina = (await call('manager', 'lumina', 'GET', '/notifications')).body;
  assert.ok(rajanLumina.items.some((n) => n.review_id === lReview.id), 'the Lumina manager is told');
  const rajanNorthwind = (await call('manager', 'northwind', 'GET', '/notifications')).body;
  assert.ok(!rajanNorthwind.items.some((n) => n.review_id === lReview.id), 'nothing leaks to the same person in another brand');
  const mayaNorthwind = (await call('creator', 'northwind', 'GET', '/notifications')).body;
  assert.ok(!mayaNorthwind.items.some((n) => n.review_id === lReview.id), 'Maya manages Northwind but is not a Lumina manager');
});
