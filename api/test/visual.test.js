import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';
import { readImageUpload, validateAssetMeta } from '../src/validate.js';

process.env.REDIS_URL = '';
const LOGO = fs.readFileSync(new URL('../seed/assets/lumina_logo.png', import.meta.url));
const B64 = LOGO.toString('base64');
const realFetch = globalThis.fetch;
let server, base, db, aiCalls = [], aiMode = 'ok';
const tokens = {};

const AI_RESULT = { text: '', score: 76, summary: '1 issue(s).', timing: { first_agent_ms: 5, total_ms: 5 }, calibration: {}, image: { width: 900, height: 520, filename: 'banner.png' },
  agents: [{ agent: 'visual', status: 'ok', mode: 'image-analysis', findings: [], latency_ms: 5, retries: 0, dropped: 0 }],
  highlights: [{ span: null, severity: 'high', agents: ['visual'], findings: [{ agent: 'visual', rule_id: 'v_logo_colour', clause_citation: 'Visual §2.2 Logo colours', region: { x: 10, y: 10, w: 100, h: 100 }, quoted_text: 'x', confidence: 0.9, severity: 'high', explanation: 'wrong colours', suggestion: 'use approved colours', kind: 'violation' }] }] };

test.before(async () => {
  db = await freshDb(); await seed(db);
  process.env.AI_SERVICE_URL = 'http://ai.test';
  globalThis.fetch = (url, init) => {
    if (!String(url).startsWith('http://ai.test')) return realFetch(url, init);
    aiCalls.push({ url: String(url), body: JSON.parse(init.body) });
    if (aiMode === 'down') return Promise.reject(new Error('ECONNREFUSED'));
    if (aiMode === 'unreadable') return Promise.resolve(new Response('{"detail":"not an image"}', { status: 422 }));
    return Promise.resolve(new Response(JSON.stringify(AI_RESULT), { status: 200 }));
  };
  server = createApp({ db, log: { enabled: () => false } }).listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { globalThis.fetch = realFetch; server.close(); await db.close(); });

async function call(role, brand, method, path, body, raw = false) {
  tokens[role] ??= (await (await realFetch(`${base}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })).json()).token;
  const res = await realFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[role]}`, ...(brand ? { 'x-brand-id': brand } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return raw ? res : { status: res.status, body: await res.json().catch(() => null) };
}

test('upload validation reads the type from the bytes, not from the name', () => {
  assert.equal(readImageUpload({ content_base64: B64 }, 1e6).mime, 'image/png');
  assert.equal(readImageUpload({ content_base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]).toString('base64') }, 1e6).mime, 'image/jpeg');
  assert.equal(readImageUpload({ content_base64: Buffer.from('<svg onload=alert(1)>').toString('base64') }, 1e6).error.error, 'unsupported_image');
  assert.equal(readImageUpload({ content_base64: Buffer.from('%PDF-1.4 ....').toString('base64') }, 1e6).error.error, 'unsupported_image');
  assert.equal(readImageUpload({ content_base64: 'not base64!!' }, 1e6).error.error, 'invalid_file');
  assert.equal(readImageUpload({}, 1e6).error.error, 'file_required');
  assert.equal(readImageUpload({ content_base64: B64 }, 100).error.error, 'file_too_large');
  assert.equal(validateAssetMeta({ kind: 'palette', name: 'Amber', hex: '#c77d0a' }), null);
  assert.equal(validateAssetMeta({ kind: 'palette', name: 'Amber', hex: 'orange' }).error, 'invalid_hex');
  assert.equal(validateAssetMeta({ kind: 'banner' }).error, 'invalid_kind');
});

test('each brand is seeded with its own logos and palette', async () => {
  const l = (await call('manager', 'lumina', 'GET', '/brand-assets')).body;
  assert.deepEqual(l.filter((a) => a.kind === 'palette').map((a) => a.hex), ['#c77d0a', '#4b2e1e', '#f5ebdd', '#222222']);
  assert.deepEqual(l.filter((a) => a.kind !== 'palette').map((a) => a.kind).sort(), ['logo', 'retired_logo']);
  assert.ok(l.every((a) => !('data' in a)), 'file contents are never listed');
  const n = (await call('creator', 'northwind', 'GET', '/brand-assets')).body;   // Maya manages Northwind
  assert.deepEqual(n.filter((a) => a.kind === 'logo').map((a) => a.name), ['Northwind logo']);
  assert.ok(!n.some((a) => a.kind === 'retired_logo'));
});

test('only managers and admins change the library; approvers may read; creators may not', async () => {
  const add = { kind: 'palette', name: 'Test', hex: '#123456' };
  assert.equal((await call('creator', 'lumina', 'POST', '/brand-assets', add)).status, 403);
  assert.equal((await call('approver', 'lumina', 'POST', '/brand-assets', add)).status, 403);
  assert.equal((await call('approver', 'lumina', 'GET', '/brand-assets')).status, 200);
  assert.equal((await call('creator', 'lumina', 'GET', '/brand-assets')).status, 403);
  const made = await call('manager', 'lumina', 'POST', '/brand-assets', add);
  assert.equal(made.status, 201); assert.equal(made.body.hex, '#123456');
  assert.equal((await call('creator', 'lumina', 'DELETE', `/brand-assets/${made.body.id}`)).status, 403);
  assert.equal((await call('manager', 'lumina', 'DELETE', `/brand-assets/${made.body.id}`)).status, 200);
  assert.equal((await call('manager', 'lumina', 'DELETE', `/brand-assets/${made.body.id}`)).status, 404);
});

test('logos are validated: bad types, oversize and a wrong colour all get a clear 400 or 413', async () => {
  const post = (b) => call('manager', 'lumina', 'POST', '/brand-assets', b);
  assert.equal((await post({ kind: 'logo', filename: 'x.png', content_base64: Buffer.from('hello world, not an image').toString('base64') })).body.error, 'unsupported_image');
  assert.equal((await post({ kind: 'logo', filename: 'x.png', content_base64: Buffer.concat([LOGO, Buffer.alloc(2_100_000)]).toString('base64') })).status, 413);
  assert.equal((await post({ kind: 'logo', content_base64: B64 })).body.error, 'invalid_filename');
  assert.equal((await post({ kind: 'palette', name: 'x', hex: '#12' })).body.error, 'invalid_hex');
  assert.equal((await post({ kind: 'palette', hex: '#123456' })).body.error, 'name_required');
  const ok = await post({ kind: 'logo', filename: 'alt.png', name: 'Icon only', content_base64: B64 });
  assert.equal(ok.status, 201);
  const img = await call('manager', 'lumina', 'GET', `/brand-assets/${ok.body.id}/image`, undefined, true);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await img.arrayBuffer()).equals(LOGO));
});

test('a palette is capped at 24 colours', async () => {
  const have = (await call('manager', 'lumina', 'GET', '/brand-assets')).body.filter((a) => a.kind === 'palette').length;
  for (let i = have; i < 24; i++) assert.equal((await call('manager', 'lumina', 'POST', '/brand-assets', { kind: 'palette', name: `c${i}`, hex: '#0000ff' })).status, 201);
  assert.equal((await call('manager', 'lumina', 'POST', '/brand-assets', { kind: 'palette', name: 'one too many', hex: '#0000ff' })).body.error, 'palette_full');
});

test('assets belong to one brand: Northwind cannot see, fetch or delete Lumina\'s', async () => {
  const lumina = (await call('manager', 'lumina', 'GET', '/brand-assets')).body.find((a) => a.kind === 'logo');
  assert.equal((await call('creator', 'northwind', 'GET', `/brand-assets/${lumina.id}/image`)).status, 404);
  assert.equal((await call('creator', 'northwind', 'DELETE', `/brand-assets/${lumina.id}`)).status, 404);
});

test('image reviews: upload runs VisualGuard with the brand\'s own assets and stores revision, image and audit entry', async () => {
  const review = (await call('creator', 'lumina', 'POST', '/reviews', { title: 'Banner', content_type: 'image' })).body;
  assert.equal(review.content_type, 'image');
  aiCalls = [];
  const run = await call('creator', 'lumina', 'POST', `/reviews/${review.id}/image`, { filename: 'banner.png', content_base64: B64 });
  assert.equal(run.status, 200); assert.equal(run.body.revision, 1); assert.equal(run.body.score, 76);
  const sent = aiCalls[0];
  assert.match(sent.url, /\/visual\/review$/);
  assert.equal(sent.body.logos.length >= 1, true); assert.equal(sent.body.retired_logos.length, 1);
  assert.ok(Buffer.from(sent.body.logos[0].data_base64, 'base64').subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'logos reach the AI service as real PNG bytes, not as a list of numbers');
  assert.ok(sent.body.palette.some((c) => c.hex === '#c77d0a') && !sent.body.palette.some((c) => c.hex === '#3f6b4a'), 'only Lumina\'s palette is sent');
  const full = (await call('creator', 'lumina', 'GET', `/reviews/${review.id}`)).body;
  assert.equal(full.revisions.length, 1); assert.equal(full.revisions[0].text, '[image] banner.png');
  assert.equal(full.revisions[0].result.highlights[0].findings[0].region.w, 100);
  const bytes = await call('creator', 'lumina', 'GET', `/reviews/${review.id}/image/1`, undefined, true);
  assert.equal(bytes.status, 200); assert.equal(bytes.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await bytes.arrayBuffer()).equals(LOGO));
  const audit = (await call('manager', 'lumina', 'GET', `/audit?review_id=${review.id}`)).body.find((a) => a.action === 'review.ran');
  assert.equal(audit.detail.kind, 'image'); assert.equal(audit.detail.flags, 1);
  assert.equal((await call('manager', 'lumina', 'GET', '/audit/verify')).body.ok, true);
});

test('the same image is served from the cache the second time', async () => {
  const review = (await call('creator', 'lumina', 'POST', '/reviews', { title: 'Cached', content_type: 'image' })).body;
  aiCalls = [];
  await call('creator', 'lumina', 'POST', `/reviews/${review.id}/image`, { filename: 'a.png', content_base64: B64 });
  await call('creator', 'lumina', 'POST', `/reviews/${review.id}/image`, { filename: 'a.png', content_base64: B64 });
  assert.equal(aiCalls.length, 0, 'same image, same assets: answered from the cache of the earlier run');
});

test('image review rules: only image reviews, only while editable, only creators and managers, bad files are refused', async () => {
  const text = (await call('creator', 'lumina', 'POST', '/reviews', { title: 'Words' })).body;
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${text.id}/image`, { content_base64: B64 })).body.error, 'not_an_image_review');
  const img = (await call('creator', 'lumina', 'POST', '/reviews', { title: 'Pic', content_type: 'image' })).body;
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${img.id}/run`, { text: 'hi' })).body.error, 'image_review', 'text cannot be run on an image review');
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${img.id}/image`, { filename: 'x', content_base64: Buffer.from('%PDF-1.4 not an image').toString('base64') })).body.error, 'unsupported_image');
  assert.equal((await call('approver', 'lumina', 'POST', `/reviews/${img.id}/image`, { content_base64: B64 })).status, 403);
  aiMode = 'unreadable';
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${img.id}/image`, { filename: 'x', content_base64: B64 + 'AAAA' })).status, 422);
  aiMode = 'down';
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${img.id}/image`, { filename: 'y', content_base64: Buffer.concat([LOGO, Buffer.from('zz')]).toString('base64') })).status, 502);
  aiMode = 'ok';
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${img.id}/image`, { filename: 'ok.png', content_base64: Buffer.concat([LOGO, Buffer.from('ok')]).toString('base64') })).status, 200);
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${img.id}/transition`, { action: 'submit' })).status, 200, 'an image review goes through the same approval workflow');
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${img.id}/image`, { filename: 'late.png', content_base64: B64 })).status, 409);
});

test('another brand cannot read an image or its review', async () => {
  const review = (await call('creator', 'lumina', 'POST', '/reviews', { title: 'Private', content_type: 'image' })).body;
  await call('creator', 'lumina', 'POST', `/reviews/${review.id}/image`, { filename: 'p.png', content_base64: B64 + 'BBBB' });
  assert.equal((await call('creator', 'northwind', 'GET', `/reviews/${review.id}/image/1`)).status, 404);
  assert.equal((await call('creator', 'northwind', 'POST', `/reviews/${review.id}/image`, { content_base64: B64 })).status, 404);
});

test('large uploads reach the handler: a 4.5 MB image and a 4 MB guideline are not stopped by the 2 MB JSON limit', async () => {
  const review = (await call('creator', 'lumina', 'POST', '/reviews', { title: 'Big picture', content_type: 'image' })).body;
  const big = Buffer.concat([LOGO, Buffer.alloc(4_500_000, 7)]).toString('base64');
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${review.id}/image`, { filename: 'big.png', content_base64: big })).status, 200);
  const tooBig = Buffer.concat([LOGO, Buffer.alloc(6_500_000, 9)]).toString('base64');
  assert.equal((await call('creator', 'lumina', 'POST', `/reviews/${review.id}/image`, { filename: 'huge.png', content_base64: tooBig })).status, 413);
  const guideline = Buffer.alloc(4_000_000, 'a').toString('base64');
  const res = await call('manager', 'lumina', 'POST', '/brand/extract', { filename: 'big.txt', content_base64: guideline });
  assert.notEqual(res.status, 413, 'the guideline reaches the extraction step');
});
