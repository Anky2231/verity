import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';
import { validateBig } from '../src/big.js';
import { computeCalibration } from '../src/calibration.js';

const realFetch = globalThis.fetch;
const SAMPLE = JSON.parse((await import('node:fs')).readFileSync(new URL('../seed/sample_result.json', import.meta.url), 'utf8'));
const GOOD_BIG = { tone_profile: { descriptors: ['warm'] }, rules: [{ id: 'r_voice_1', clause_ref: 'Voice §1.2', type: 'tone', severity: 'medium', text: 'Be warm.' }],
  glossary: [{ id: 't_1', approved: 'coffee beans', banned: ['java'], reason: 'slang' }], claims: [{ id: 'c_1', text: 'We roast in small batches', source_doc: 'Ops', page: 3 }] };

// Boots a fresh API + database with a scripted AI service.
async function boot({ aiDown = false, env = {} } = {}) {
  Object.assign(process.env, { AI_SERVICE_URL: 'http://ai.test', REDIS_URL: '', ...env });
  const db = await freshDb(); await seed(db);
  const seen = { review: 0, bodies: [] };
  const agent = (n) => ({ agent: n, status: 'ok', mode: 'rules', findings: [], latency_ms: 5, retries: 0 });
  const result = (text) => ({ text, score: 80, agents: ['claim', 'term', 'tone'].map(agent), timing: { first_agent_ms: 3, total_ms: 9 },
    highlights: [{ span: { start: 0, end: 4 }, severity: 'medium', agents: ['term'], findings: [{ agent: 'term', rule_id: 't_1', quoted_text: 'java' }] }] });
  globalThis.fetch = (url, init) => {
    const u = String(url);
    if (!u.startsWith('http://ai.test')) return realFetch(url, init);
    if (aiDown) return Promise.reject(new Error('connect ECONNREFUSED'));
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.endsWith('/extract')) return Promise.resolve(new Response(JSON.stringify({ big: GOOD_BIG, notes: ['example note'], chars: 10 }), { status: 200 }));
    if (u.endsWith('/stream/review')) {
      seen.review++; seen.bodies.push(body);
      const lines = [...['claim', 'term', 'tone'].map((n) => JSON.stringify({ event: 'agent', result: agent(n) })), JSON.stringify({ event: 'done', result: result(body.text) })];
      return Promise.resolve(new Response(lines.join('\n') + '\n', { status: 200 }));
    }
    if (u.endsWith('/review')) { seen.review++; seen.bodies.push(body); return Promise.resolve(new Response(JSON.stringify(result(body.text)), { status: 200 })); }
    return Promise.resolve(new Response('{}', { status: 404 }));
  };
  const server = createApp({ db }).listen(0); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`, tokens = {};
  const call = async (role, method, path, body) => {
    tokens[role] ??= (await (await realFetch(`${base}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })).json()).token;
    const res = await realFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[role]}` }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: (() => { try { return JSON.parse(text); } catch { return text; } })(), headers: res.headers, text };
  };
  let closed = false;
  const close = async () => { if (closed) return; closed = true; globalThis.fetch = realFetch; server.close(); server.closeAllConnections?.(); await db.close(); };
  servers.push(close);
  return { db, seen, call, close };
}
const servers = [];
test.after(async () => { for (const c of servers) await c(); });
const newReview = async (call, title = 'T') => (await call('creator', 'POST', '/reviews', { title })).body.id;

test('validateBig rejects incomplete guidelines with specific messages and sanitises good ones', () => {
  const bad = validateBig({ rules: [{ id: 'a', type: 'tone', severity: 'urgent', text: '' }], glossary: [{ id: 'a', approved: 'x', banned: [] }], claims: [{ id: 'c', text: 'x' }] }, { brandId: 'b', version: 2 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /severity/.test(e)) && bad.errors.some((e) => /duplicate id/.test(e)) && bad.errors.some((e) => /source document/.test(e)) && bad.errors.some((e) => /banned variant/.test(e)));
  assert.equal(validateBig({}, { brandId: 'b', version: 2 }).ok, false);
  const ok = validateBig({ ...GOOD_BIG, evil: '<script>' }, { brandId: 'lumina', version: 2 });
  assert.ok(ok.ok && ok.big.version === 2 && !('evil' in ok.big));
});

test('BIG builder: only manager/admin can extract and publish; publish creates a new immutable version', async () => {
  const t = await boot();
  assert.equal((await t.call('creator', 'POST', '/brand/extract', { use_sample: true })).status, 403);
  assert.equal((await t.call('creator', 'POST', '/brand/publish', { big: GOOD_BIG })).status, 403);
  const ex = await t.call('manager', 'POST', '/brand/extract', { use_sample: true });
  assert.equal(ex.status, 200); assert.equal(ex.body.notes[0], 'example note');
  assert.equal((await t.call('manager', 'POST', '/brand/extract', {})).status, 400);
  const bad = await t.call('manager', 'POST', '/brand/publish', { big: { rules: [] } });
  assert.equal(bad.status, 400); assert.ok(bad.body.errors.length);
  const pub = await t.call('manager', 'POST', '/brand/publish', { big: GOOD_BIG });
  assert.equal(pub.status, 201); assert.equal(pub.body.version, 2);
  const brand = await t.call('manager', 'GET', '/brand');
  assert.deepEqual(brand.body.versions.map((v) => v.version), [2, 1]);
  assert.equal((await t.call('manager', 'GET', '/brand/versions/1')).body.version, 1);
  // a review created now pins BIG v2 and the AI receives it
  const id = await newReview(t.call);
  await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'my java' });
  assert.equal(t.seen.bodies[0].big_version, 2); assert.equal(t.seen.bodies[0].big.rules[0].id, 'r_voice_1');
  const audit = (await t.call('manager', 'GET', '/audit')).body.map((a) => a.action);
  assert.ok(audit.includes('big.extracted') && audit.includes('big.published'));
  await t.close();
});

test('review cache: identical content is served without calling the AI again', async () => {
  const t = await boot(); const id = await newReview(t.call);
  const a = await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'Grab java today' });
  const b = await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'Grab java today' });
  const c = await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'Grab java today!' });
  assert.equal(t.seen.review, 2); assert.ok(!a.body.cached && b.body.cached && !c.body.cached);
  assert.deepEqual([a.body.revision, b.body.revision, c.body.revision], [1, 2, 3]);
  await t.close();
});

test('rate limit returns 429 with retry-after', async () => {
  const t = await boot({ env: { RUN_LIMIT_PER_MIN: '2' } }); const id = await newReview(t.call);
  for (const n of [1, 2]) assert.equal((await t.call('creator', 'POST', `/reviews/${id}/run`, { text: `v${n}` })).status, 200);
  const r = await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'v3' });
  assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
  delete process.env.RUN_LIMIT_PER_MIN; await t.close();
});

test('streaming run emits one event per agent then done, and stores the revision', async () => {
  const t = await boot(); const id = await newReview(t.call);
  const r = await t.call('creator', 'POST', `/reviews/${id}/run/stream`, { text: 'Grab java' });
  const events = [...r.text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => [m[1], JSON.parse(m[2])]);
  assert.deepEqual(events.map((e) => e[0]), ['agent', 'agent', 'agent', 'done']);
  assert.equal(events[3][1].revision, 1);
  assert.equal((await t.call('creator', 'GET', `/reviews/${id}`)).body.revisions.length, 1);
  await t.close();
});

test('AI down: the built-in sample is served from a labelled cached result; other text gets a clear 502', async () => {
  const t = await boot({ aiDown: true }); const id = await newReview(t.call);
  const demo = await t.call('creator', 'POST', `/reviews/${id}/run`, { text: SAMPLE.content });
  assert.equal(demo.status, 200); assert.equal(demo.body.cached_demo, true); assert.equal(demo.body.score, SAMPLE.result.score);
  const other = await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'Something the user typed' });
  assert.equal(other.status, 502); assert.equal(other.body.error, 'ai_unavailable');
  await t.close();
});

test('learning loop: rules that reviewers keep disputing get a higher cutoff that is sent to the AI', async () => {
  const t = await boot(); const id = await newReview(t.call);
  await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'first' });
  for (let i = 0; i < 5; i++) {
    const r = await t.call('creator', 'POST', `/reviews/${id}/decisions`, { revision: 1, flag_key: `0-${i}`, rule_id: 'r_voice_1', agent: 'tone', quoted_text: 'x', decision: 'disputed', reason: 'fits our trade voice' });
    assert.equal(r.status, 201);
  }
  for (let i = 0; i < 6; i++) await t.call('creator', 'POST', `/reviews/${id}/decisions`, { revision: 1, flag_key: `1-${i}`, rule_id: 't_1', agent: 'term', quoted_text: 'java', decision: 'accepted' });
  const cal = await computeCalibration(t.db, 'lumina');
  assert.deepEqual(cal.cutoffs, { r_voice_1: 0.75 });
  await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'second' });
  assert.deepEqual(t.seen.bodies.at(-1).calibration, { r_voice_1: 0.75 });
  const a = (await t.call('manager', 'GET', '/analytics/summary')).body;
  assert.ok(a.calibration.find((c) => c.rule_id === 'r_voice_1').raised);
  await t.close();
});

test('notifications: submit notifies managers, approve notifies the creator, read clears the badge', async () => {
  const t = await boot(); const id = await newReview(t.call);
  await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'Grab java' });
  await t.call('creator', 'POST', `/reviews/${id}/transition`, { action: 'submit' });
  let m = (await t.call('manager', 'GET', '/notifications')).body;
  assert.equal(m.unread, 1); assert.match(m.items[0].message, /submitted/); assert.equal(m.items[0].email_status, 'skipped');
  assert.equal((await t.call('creator', 'GET', '/notifications')).body.unread, 0);
  await t.call('manager', 'POST', `/reviews/${id}/transition`, { action: 'approve' });
  const c = (await t.call('creator', 'GET', '/notifications')).body;
  assert.equal(c.unread, 1); assert.match(c.items[0].message, /approved/);
  await t.call('manager', 'POST', '/notifications/read');
  assert.equal((await t.call('manager', 'GET', '/notifications')).body.unread, 0);
  await t.close();
});

test('queue shows delta between the last two revisions; analytics exposes dashboard fields', async () => {
  const t = await boot(); const id = await newReview(t.call);
  await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'one' });
  await t.call('creator', 'POST', `/reviews/${id}/run`, { text: 'two' });
  assert.equal((await t.call('creator', 'GET', '/reviews')).body[0].delta, 0);
  const a = (await t.call('manager', 'GET', '/analytics/summary')).body;
  for (const k of ['reviews_total', 'reviews_last_30d', 'avg_score', 'avg_hours_to_approve', 'ai_vs_human', 'findings_by_content_type', 'findings_by_creator', 'score_trend', 'calibration'])
    assert.ok(k in a, k);
  assert.equal((await t.call('creator', 'GET', '/analytics/summary')).status, 403);
  await t.close();
});
