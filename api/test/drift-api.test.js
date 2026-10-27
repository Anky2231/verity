import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';
import { seedHistory } from '../src/seed-history.js';
import { seedDrift } from '../src/seed-drift.js';

process.env.REDIS_URL = '';
let server, base, db;
const tokens = {};
test.before(async () => {
  db = await freshDb(); await seed(db); await seedHistory(db); await seedDrift(db);
  server = createApp({ db, log: { enabled: () => false } }).listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.close(); });

async function call(role, brand, path) {
  tokens[role] ??= (await (await fetch(`${base}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })).json()).token;
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${tokens[role]}`, ...(brand ? { 'x-brand-id': brand } : {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('ACCEPTANCE: on the seeded history the planted drift is found in Social and nowhere else', async () => {
  const { status, body } = await call('manager', 'lumina', '/drift');
  assert.equal(status, 200);
  const by = Object.fromEntries(body.teams.map((t) => [t.team, t]));
  assert.deepEqual(Object.keys(by).sort(), ['Blog', 'Content', 'Email', 'Social']);
  assert.equal(by.Social.status, 'drifting');
  assert.ok(by.Social.score >= 3.5 && by.Social.ratio >= 1.3);
  for (const quiet of ['Blog', 'Content', 'Email']) assert.equal(by[quiet].status, 'stable', `${quiet} must not raise an alert`);
  assert.equal(by.Social.rising_clauses[0].clause, 'Voice §1.2', 'the planted drift is in jargon, Voice §1.2');
  const weeks = by.Social.series.map((p) => p.week);
  assert.ok(weeks.length >= 9);
  assert.deepEqual(by.Email.series.map((p) => p.week), weeks, 'every team is shown over the same weeks');
});

test('Social\'s weekly rate really is higher in its last three weeks than in its first four', async () => {
  const social = (await call('manager', 'lumina', '/drift')).body.teams.find((t) => t.team === 'Social');
  const early = social.series.slice(0, 4).filter((p) => p.rate != null).map((p) => p.rate);
  const late = social.series.slice(-3).filter((p) => p.rate != null).map((p) => p.rate);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(late) > 1.8 * mean(early), `late ${mean(late).toFixed(2)} vs early ${mean(early).toFixed(2)}`);
});

test('the digest is created once per week, and managers are told once per drifting team', async () => {
  const first = (await call('manager', 'lumina', '/drift')).body.digest;
  assert.match(first.text, /Social is drifting/);
  assert.match(first.text, /Most likely next: Voice §1\.2/);
  assert.ok(first.drifting.some((t) => t.team === 'Social'));
  for (let i = 0; i < 3; i++) assert.equal((await call('manager', 'lumina', '/drift')).body.digest.is_new, false);
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM drift_digests WHERE brand_id='lumina'`);
  assert.equal(n, 1);
  const alerts = (await call('manager', 'lumina', '/notifications')).body.items.filter((x) => /Drift alert: the Social team/.test(x.message));
  assert.equal(alerts.length, 1, 'opening the page again must not send the alert again');
  const approverAlerts = (await call('approver', 'lumina', '/notifications')).body.items.filter((x) => /Drift alert/.test(x.message));
  assert.equal(approverAlerts.length, 0, 'alerts go to managers and admins');
});

test('roles: creators are refused, approvers may read, no token is 401', async () => {
  assert.equal((await call('creator', 'lumina', '/drift')).status, 403);
  assert.equal((await call('approver', 'lumina', '/drift')).status, 200);
  assert.equal((await fetch(`${base}/drift`)).status, 401);
});

test('drift is per brand: Northwind has no history, so nothing is judged and nothing leaks from Lumina', async () => {
  const res = await call('creator', 'northwind', '/drift');   // Maya manages Northwind
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.teams, []); assert.equal(res.body.anchor_week, null); assert.equal(res.body.digest, null);
});

test('seeding twice does not duplicate the drift history', async () => {
  const [{ n: before }] = await db.query('SELECT count(*)::int AS n FROM reviews');
  await seedDrift(db);
  const [{ n: after }] = await db.query('SELECT count(*)::int AS n FROM reviews');
  assert.equal(after, before);
});

test('the audit chain still verifies with the seeded drift history in it', async () => {
  assert.equal((await call('manager', 'lumina', '/audit/verify')).body.ok, true);
});
