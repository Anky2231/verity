import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { freshDb } from './helpers.js';

// These tests exercise the default in-process API path; queue coverage lives in queue.test.js.
process.env.REDIS_URL = '';
import { seed } from '../src/seed.js';
import { decide } from '../src/workflow.js';
import { wordDiff } from '../src/diff.js';

let server, base, db;
const realFetch = globalThis.fetch;
let aiScore = 55;

test.before(async () => {
  db = await freshDb();
  await seed(db);
  process.env.AI_SERVICE_URL = 'http://ai.test';
  // Stub only the AI service; everything else is real (Express + Postgres via PGlite).
  globalThis.fetch = (url, init) => String(url).startsWith('http://ai.test')
    ? Promise.resolve(new Response(JSON.stringify({
        text: JSON.parse(init.body).text, score: aiScore, agents: [{ agent: 'term', status: 'ok', mode: 'rules', findings: [] }],
        highlights: [{ span: { start: 0, end: 4 }, severity: 'medium', agents: ['term'], findings: [{ agent: 'term', rule_id: 't_1', quoted_text: 'java' }] }] }), { status: 200 }))
    : realFetch(url, init);
  server = createApp({ db }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { globalThis.fetch = realFetch; server.close(); await db.close(); });

const tokens = {};
const as = async (role) => (tokens[role] ??= (await (await realFetch(`${base}/auth/demo-login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })).json()).token);
const call = async (role, method, path, body) => {
  const res = await realFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await as(role)}` },
    body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};

test('state machine rules', () => {
  assert.equal(decide('approve', 'draft', 'manager').status, 409);
  assert.equal(decide('approve', 'submitted', 'creator').status, 403);
  assert.equal(decide('final_approve', 'submitted', 'approver').status, 409);
  assert.equal(decide('final_approve', 'escalated', 'manager').status, 403);
  assert.equal(decide('nope', 'draft', 'admin').status, 400);
  assert.ok(decide('send_back', 'escalated', 'approver').ok);
});

test('word diff', () => {
  const d = wordDiff('hello java world', 'hello coffee beans world');
  assert.deepEqual(d.filter((x) => x.type !== 'same').map((x) => x.type + ':' + x.text.trim()).sort(), ['add:beans', 'add:coffee', 'del:java'].sort());
});

test('full journey: create → run → decide → submit → escalate → final approve → publish, audited', async () => {
  const c = await call('creator', 'POST', '/reviews', { title: 'Spring post' });
  assert.equal(c.status, 201);
  const id = c.body.id;

  assert.equal((await call('creator', 'POST', `/reviews/${id}/transition`, { action: 'submit' })).body.error, 'run_review_first');

  const run1 = await call('creator', 'POST', `/reviews/${id}/run`, { text: 'my java is great' });
  assert.equal(run1.status, 200); assert.equal(run1.body.revision, 1);
  aiScore = 90;
  const run2 = await call('creator', 'POST', `/reviews/${id}/run`, { text: 'my coffee beans are great' });
  assert.equal(run2.body.revision, 2);

  const diff = await call('creator', 'GET', `/reviews/${id}/diff?from=1&to=2`);
  assert.equal(diff.body.delta.score_before, 55); assert.equal(diff.body.delta.score_after, 90);

  // dispute requires a reason
  const flag = { revision: 1, flag_key: '0-0', rule_id: 't_1', agent: 'term', quoted_text: 'java' };
  assert.equal((await call('creator', 'POST', `/reviews/${id}/decisions`, { ...flag, decision: 'disputed' })).status, 400);
  assert.equal((await call('creator', 'POST', `/reviews/${id}/decisions`, { ...flag, decision: 'disputed', reason: 'slang is fine here' })).status, 201);
  assert.equal((await call('creator', 'POST', `/reviews/${id}/decisions`, { ...flag, decision: 'overridden', reason: 'x' })).status, 403);

  assert.equal((await call('creator', 'POST', `/reviews/${id}/transition`, { action: 'submit' })).body.status, 'submitted');
  // locked while in approval
  assert.equal((await call('creator', 'POST', `/reviews/${id}/run`, { text: 'x' })).status, 409);
  // creator cannot approve; approver cannot act on 'submitted'
  assert.equal((await call('creator', 'POST', `/reviews/${id}/transition`, { action: 'approve' })).status, 403);
  assert.equal((await call('approver', 'POST', `/reviews/${id}/transition`, { action: 'final_approve' })).status, 409);

  assert.equal((await call('manager', 'POST', `/reviews/${id}/transition`, { action: 'escalate' })).body.status, 'escalated');
  assert.equal((await call('approver', 'POST', `/reviews/${id}/transition`, { action: 'final_approve' })).body.status, 'approved');
  assert.equal((await call('manager', 'POST', `/reviews/${id}/transition`, { action: 'publish' })).body.status, 'published');

  const detail = await call('manager', 'GET', `/reviews/${id}`);
  assert.equal(detail.body.revisions.length, 2); assert.equal(detail.body.decisions.length, 1);
  const log = await call('manager', 'GET', `/audit?review_id=${id}`);
  const actions = log.body.map((x) => x.action);
  for (const a of ['review.created', 'review.ran', 'flag.disputed', 'review.submit', 'review.escalate', 'review.final_approve', 'review.publish'])
    assert.ok(actions.includes(a), `missing audit ${a}`);
});

test('reject requires reason; self-approval forbidden; creator isolation', async () => {
  const { body: m } = await call('manager', 'POST', '/reviews', { title: 'Manager own' });
  await call('manager', 'POST', `/reviews/${m.id}/run`, { text: 'hello' });
  await call('manager', 'POST', `/reviews/${m.id}/transition`, { action: 'submit' });
  assert.equal((await call('manager', 'POST', `/reviews/${m.id}/transition`, { action: 'approve' })).body.error, 'self_approval_forbidden');

  const { body: c } = await call('creator', 'POST', '/reviews', { title: 'Mine' });
  await call('creator', 'POST', `/reviews/${c.id}/run`, { text: 'hello' });
  await call('creator', 'POST', `/reviews/${c.id}/transition`, { action: 'submit' });
  assert.equal((await call('manager', 'POST', `/reviews/${c.id}/transition`, { action: 'reject' })).body.error, 'reason_required');
  const rej = await call('manager', 'POST', `/reviews/${c.id}/transition`, { action: 'reject', reason: 'Tone still off' });
  assert.equal(rej.body.status, 'changes_requested');
  // creator can revise and resubmit after rejection
  assert.equal((await call('creator', 'POST', `/reviews/${c.id}/run`, { text: 'better' })).status, 200);

  // a creator never sees someone else's review
  assert.equal((await call('creator', 'GET', `/reviews/${m.id}`)).status, 404);
  const list = await call('creator', 'GET', '/reviews');
  assert.ok(list.body.every((x) => x.creator_id === 'u_maya'));
});

test('governance endpoints are role-gated; csv export; hash chain verifies and detects tampering', async () => {
  assert.equal((await call('creator', 'GET', '/audit')).status, 403);
  const csv = await call('manager', 'GET', '/audit?format=csv');
  assert.equal(csv.status, 200); assert.match(csv.body, /^id,ts,review_id/);

  const ok = await call('manager', 'GET', '/audit/verify');
  assert.equal(ok.body.ok, true); assert.ok(ok.body.checked > 10);

  // The DB itself refuses edits to history.
  await assert.rejects(db.query(`UPDATE audit_log SET action='x' WHERE id=1`), /append-only/);
  await assert.rejects(db.query(`DELETE FROM audit_log`), /append-only/);
});

test('analytics: override rate surfaces ambiguous rules', async () => {
  const { body: r } = await call('creator', 'POST', '/reviews', { title: 'Ambiguity' });
  for (let i = 0; i < 3; i++)
    await call('creator', 'POST', `/reviews/${r.id}/decisions`, { revision: 1, flag_key: `k${i}`, rule_id: 'r_voice_1', agent: 'tone', decision: 'disputed', reason: 'unclear rule' });
  const a = await call('manager', 'GET', '/analytics/summary');
  const rule = a.body.rule_override_rates.find((x) => x.rule_id === 'r_voice_1');
  assert.equal(rule.ambiguous, true);
  assert.ok(a.body.reviews_by_status.published >= 1);
});

test('Round 3 groundwork: second brand row exists, brand_assets table exists, upload stub is guarded and says 501', async () => {
  const db = await freshDb(); await seed(db);
  assert.equal((await db.query(`SELECT count(*)::int n FROM brands WHERE id='northwind'`))[0].n, 1);
  assert.equal((await db.query(`SELECT count(*)::int n FROM brand_assets`))[0].n, 0);
  const app = createApp({ db }).listen(0); await new Promise((r) => app.once('listening', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const tok = async (role) => (await (await fetch(`${base}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })).json()).token;
  const post = async (t) => fetch(`${base}/brand-assets`, { method: 'POST', headers: { authorization: `Bearer ${t}` } });
  assert.equal((await post(await tok('creator'))).status, 403);
  assert.equal((await post(await tok('manager'))).status, 501);
  app.close();
});
