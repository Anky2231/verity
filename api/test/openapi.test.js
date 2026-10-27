import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load } from 'js-yaml';
import { createApp } from '../src/app.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';

process.env.REDIS_URL = '';
const spec = load(fs.readFileSync(new URL('../../docs/openapi.yaml', import.meta.url), 'utf8'));
const ROLES = ['creator', 'manager', 'approver', 'admin'];
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Express 4 keeps routes in nested layer stacks; the mount path of a router is only available as a regular expression.
function mountOf(layer) {
  const src = layer.regexp.source;
  if (src === '^\\/?(?=\\/|$)') return '';
  return src.replace('^', '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
}
function routesOf(stack, prefix = '') {
  const out = [];
  for (const l of stack) {
    if (l.route) for (const m of Object.keys(l.route.methods)) out.push(`${m.toUpperCase()} ${prefix}${l.route.path}`.replace(/\/$/, '') || '/');
    else if (l.name === 'router') out.push(...routesOf(l.handle.stack, prefix + mountOf(l)));
  }
  return out;
}
const toSpecPath = (p) => p.replace(/:(\w+)/g, '{$1}');

let server, base, db;
const tokens = {};
test.before(async () => {
  db = await freshDb(); await seed(db);
  server = createApp({ db }).listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const role of ROLES)
    tokens[role] = (await (await fetch(`${base}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })).json()).token;
});
test.after(async () => { server.close(); await db.close(); });

const documented = () => Object.entries(spec.paths).flatMap(([p, item]) => METHODS.filter((m) => item[m]).map((m) => ({ method: m.toUpperCase(), path: p, op: item[m] })));

test('every route in the code is documented, and every documented route exists', () => {
  const app = createApp({ db });
  const inCode = new Set(routesOf(app._router.stack).map((r) => { const [m, p] = r.split(' '); return `${m} ${toSpecPath(p)}`; }));
  const inSpec = new Set(documented().map((d) => `${d.method} ${d.path}`));
  assert.deepEqual([...inCode].filter((r) => !inSpec.has(r)), [], 'routes missing from docs/openapi.yaml');
  assert.deepEqual([...inSpec].filter((r) => !inCode.has(r)), [], 'documented routes that the code does not have');
  assert.ok(inSpec.size >= 25);
});

test('every operation names its roles and has a summary and at least one response', () => {
  for (const d of documented()) {
    const where = `${d.method} ${d.path}`;
    assert.ok(Array.isArray(d.op['x-roles']) && d.op['x-roles'].length, `${where} needs x-roles`);
    assert.ok(d.op.summary, `${where} needs a summary`);
    assert.ok(Object.keys(d.op.responses ?? {}).length, `${where} needs responses`);
    const open = d.op['x-roles'].includes('public');
    assert.equal(!open, d.op.security === undefined, `${where}: public routes must set security: [], protected ones inherit the bearer scheme`);
    if (!open) { assert.ok(d.op.responses['401'], `${where} should document 401`); }
    if (!open && d.op['x-roles'].length < ROLES.length) assert.ok(d.op.responses['403'], `${where} should document 403`);
  }
});

const fill = (p) => p.replace('{id}', '999999').replace('{v}', '1').replace('{token}', 'not-a-real-token');

test('no token gets 401 on every protected route', async () => {
  for (const d of documented().filter((x) => !x.op['x-roles'].includes('public'))) {
    const res = await fetch(`${base}${fill(d.path)}`, { method: d.method, headers: { 'content-type': 'application/json' }, body: d.method === 'GET' ? undefined : '{}' });
    assert.equal(res.status, 401, `${d.method} ${d.path} without a token`);
  }
});

test('roles outside x-roles get 403, and allowed roles are never turned away', async () => {
  for (const d of documented().filter((x) => !x.op['x-roles'].includes('public'))) {
    for (const role of ROLES) {
      const res = await fetch(`${base}${fill(d.path)}`, { method: d.method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[role]}` }, body: d.method === 'GET' ? undefined : '{}' });
      await res.arrayBuffer();
      const allowed = d.op['x-roles'].includes(role);
      if (!allowed) assert.equal(res.status, 403, `${d.method} ${d.path} as ${role} should be forbidden`);
      else assert.notEqual(res.status, 401, `${d.method} ${d.path} as ${role} should not be unauthenticated`);
      if (allowed && d.op['x-roles'].length < ROLES.length) assert.notEqual(res.status, 403, `${d.method} ${d.path} as ${role} is documented as allowed`);
    }
  }
});

test('public routes answer without a token', async () => {
  for (const d of documented().filter((x) => x.op['x-roles'].includes('public') && x.method === 'GET' && !x.path.includes('{'))) {
    const res = await fetch(`${base}${d.path}`); await res.arrayBuffer();
    assert.equal(res.status, 200, d.path);
  }
});

test('the documented error and success shapes match a real response', async () => {
  const bad = await (await fetch(`${base}/analytics/summary`)).json();
  assert.ok(typeof bad.error === 'string');
  const health = await (await fetch(`${base}/health`)).json();
  for (const k of spec.components.schemas.Health.required) assert.ok(k in health, `/health lacks ${k}`);
  const page = await (await fetch(`${base}/audit?limit=2`, { headers: { authorization: `Bearer ${tokens.manager}` } })).json();
  for (const k of spec.components.schemas.AuditPage.required) assert.ok(k in page, `paged audit lacks ${k}`);
});
