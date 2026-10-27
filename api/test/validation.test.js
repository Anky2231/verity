import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';
import { validateNewReview, validateComment, validateDecision, validateReason } from '../src/validate.js';

process.env.REDIS_URL = '';
let server, base, db;
const tokens = {};
test.before(async () => {
  db = await freshDb(); await seed(db);
  server = createApp({ db }).listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.close(); });

async function call(role, method, path, body) {
  tokens[role] ??= (await (await fetch(`${base}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })).json()).token;
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[role]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('content_type accepts only blog, social and email', async () => {
  for (const ok of ['blog', 'social', 'email']) assert.equal((await call('creator', 'POST', '/reviews', { title: 'T', content_type: ok })).status, 201);
  const bad = await call('creator', 'POST', '/reviews', { title: 'T', content_type: 'billboard' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_content_type');
  assert.match(bad.body.detail, /blog, social, email/);
  assert.equal((await call('creator', 'POST', '/reviews', { title: 'T' })).status, 201, 'omitted content_type still defaults to blog');
});

test('a review title is capped at 200 characters and must be text', async () => {
  assert.equal((await call('creator', 'POST', '/reviews', { title: 'x'.repeat(201) })).body.error, 'title_too_long');
  assert.equal((await call('creator', 'POST', '/reviews', { title: 'x'.repeat(200) })).status, 201);
  assert.equal((await call('creator', 'POST', '/reviews', { title: 42 })).body.error, 'invalid_title');
});

test('comments cannot be empty or longer than 2000 characters', async () => {
  const { body: { id } } = await call('creator', 'POST', '/reviews', { title: 'C' });
  assert.equal((await call('creator', 'POST', `/reviews/${id}/comments`, { body: '   ' })).body.error, 'body_required');
  assert.equal((await call('creator', 'POST', `/reviews/${id}/comments`, { body: 7 })).body.error, 'body_required');
  assert.equal((await call('creator', 'POST', `/reviews/${id}/comments`, { body: 'y'.repeat(2001) })).body.error, 'comment_too_long');
  assert.equal((await call('creator', 'POST', `/reviews/${id}/comments`, { body: 'y'.repeat(2000) })).status, 201);
});

test('decision fields are validated before anything is stored', async () => {
  const { body: { id } } = await call('creator', 'POST', '/reviews', { title: 'D' });
  const post = (b) => call('creator', 'POST', `/reviews/${id}/decisions`, b);
  assert.equal((await post({ decision: 'maybe', flag_key: 'k', revision: 1 })).body.error, 'invalid_decision');
  assert.equal((await post({ decision: 'accepted', revision: 1 })).body.error, 'flag_key_and_revision_required');
  assert.equal((await post({ decision: 'accepted', flag_key: 'k', revision: 0 })).body.error, 'flag_key_and_revision_required');
  assert.equal((await post({ decision: 'accepted', flag_key: 'k', revision: 1.5 })).body.error, 'flag_key_and_revision_required');
  assert.equal((await post({ decision: 'disputed', flag_key: 'k', revision: 1, reason: 'z'.repeat(1001) })).body.error, 'reason_too_long');
  assert.equal((await post({ decision: 'disputed', flag_key: 'k', revision: 1 })).body.error, 'reason_required');
  assert.equal((await post({ decision: 'accepted', flag_key: 'k', revision: 1, rule_id: {} })).body.error, 'invalid_rule_id');
  assert.equal((await post({ decision: 'accepted', flag_key: 'k', revision: 1 })).status, 201);
  assert.equal((await post({ decision: 'overridden', flag_key: 'k', revision: 1, reason: 'r' })).status, 403, 'role rules still apply to valid input');
});

test('a transition reason must be text and at most 1000 characters', async () => {
  const { body: { id } } = await call('creator', 'POST', '/reviews', { title: 'R' });
  assert.equal((await call('creator', 'POST', `/reviews/${id}/transition`, { action: 'submit', reason: 'q'.repeat(1001) })).body.error, 'reason_too_long');
  assert.equal((await call('creator', 'POST', `/reviews/${id}/transition`, { action: 'submit', reason: {} })).body.error, 'invalid_reason');
});

test('the rules are plain functions that return null when the input is fine', () => {
  assert.equal(validateNewReview({ title: 'ok', content_type: 'email' }), null);
  assert.equal(validateNewReview(), null);
  assert.equal(validateComment({ body: 'hi' }), null);
  assert.equal(validateDecision({ decision: 'manual', flag_key: 'k', revision: 2 }), null);
  assert.equal(validateReason(undefined), null);
});

test('GET /reviews: no limit returns the plain array; limit pages through every review once, newest first', async () => {
  for (let i = 0; i < 7; i++) await call('creator', 'POST', '/reviews', { title: `Page ${i}` });
  const all = await call('creator', 'GET', '/reviews');
  assert.ok(Array.isArray(all.body));
  const seen = []; let cursor = null, pages = 0;
  do {
    const r = await call('creator', 'GET', `/reviews?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(r.status, 200); assert.ok(r.body.items.length <= 3);
    seen.push(...r.body.items.map((x) => x.id)); cursor = r.body.next_cursor; pages++;
  } while (cursor);
  assert.deepEqual(seen, all.body.map((x) => x.id), 'pages concatenate to exactly the unpaged list, in the same order');
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(pages >= 3);
});

test('GET /reviews: bad limit or cursor is a 400 with a reason', async () => {
  for (const q of ['limit=0', 'limit=201', 'limit=abc', 'limit=1.5', 'cursor=whatever', 'limit=2&cursor=!!!'])
    assert.equal((await call('creator', 'GET', `/reviews?${q}`)).status, 400, q);
  assert.equal((await call('creator', 'GET', '/reviews?limit=0')).body.error, 'invalid_limit');
});

test('GET /audit: pages walk backwards through the whole trail with no gaps or repeats', async () => {
  const everything = await call('manager', 'GET', '/audit');
  assert.ok(Array.isArray(everything.body) && everything.body.length > 5);
  const ids = []; let before = null;
  do {
    const r = await call('manager', 'GET', `/audit?limit=4${before ? `&before_id=${before}` : ''}`);
    assert.equal(r.status, 200);
    const page = r.body.items.map((x) => x.id);
    assert.deepEqual(page, [...page].sort((a, b) => a - b), 'each page is oldest first');
    ids.unshift(...page); before = r.body.next_before_id;
  } while (before);
  assert.deepEqual(ids, everything.body.map((x) => x.id));
});

test('GET /audit: invalid paging and filter values are 400s', async () => {
  for (const q of ['limit=0', 'limit=1001', 'before_id=5', 'limit=2&before_id=x', 'review_id=abc'])
    assert.equal((await call('manager', 'GET', `/audit?${q}`)).status, 400, q);
});

test('GET /reviews?q= searches titles, ignoring case, and treats % and _ literally', async () => {
  await call('creator', 'POST', '/reviews', { title: 'Autumn Harvest 100% promo' });
  await call('creator', 'POST', '/reviews', { title: 'Autumn Harvest 100 percent' });
  const hit = async (q) => (await call('creator', 'GET', `/reviews?q=${encodeURIComponent(q)}`)).body.map((r) => r.title);
  assert.deepEqual(await hit('autumn harvest 100%'), ['Autumn Harvest 100% promo']);
  assert.equal((await hit('harvest')).length, 2);
  assert.deepEqual(await hit('zzz-no-such-title'), []);
  assert.ok((await hit('')).length > 2, 'an empty search is no search');
  assert.deepEqual(await hit('100_'), [], '_ is not a wildcard');
  assert.equal((await call('creator', 'GET', `/reviews?q=${'x'.repeat(101)}`)).body.error, 'invalid_q');
  const page = (await call('creator', 'GET', '/reviews?q=harvest&limit=1')).body;
  assert.equal(page.items.length, 1); assert.ok(page.next_cursor, 'search works together with paging');
});
