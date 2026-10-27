// End to end with the real AI service: the API sends a brand's real logos and palette, the AI service finds a planted
// violation in a held-out image, and the result comes back with a region. Runs only when VISUAL_REAL_AI=1 and the AI service
// is up at AI_SERVICE_URL (CI starts it for the Redis tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { freshDb } from './helpers.js';
import { seed } from '../src/seed.js';

process.env.REDIS_URL = '';
const enabled = process.env.VISUAL_REAL_AI === '1';
const EVAL = new URL('../../ai/eval/visual/', import.meta.url);
const labels = enabled ? JSON.parse(fs.readFileSync(new URL('heldout.json', EVAL), 'utf8')) : [];

test('real VisualGuard through the API finds a recoloured logo, a retired logo and an off-palette colour', { skip: !enabled }, async () => {
  const db = await freshDb(); await seed(db);
  const server = createApp({ db, log: { enabled: () => false } }).listen(0); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (await (await fetch(`${base}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'creator' }) })).json()).token;
  const call = async (method, path, body) => { const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-brand-id': 'lumina' }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  try {
    for (const [kind, rule] of [['recoloured', 'v_logo_colour'], ['retired', 'v_logo_retired'], ['palette', 'v_palette']]) {
      const lab = labels.find((l) => l.kind === kind);
      const review = (await call('POST', '/reviews', { title: `Real ${kind}`, content_type: 'image' })).body;
      const run = await call('POST', `/reviews/${review.id}/image`, { filename: lab.file, content_base64: fs.readFileSync(new URL(lab.file, EVAL)).toString('base64') });
      assert.equal(run.status, 200, JSON.stringify(run.body));
      const found = run.body.highlights.flatMap((h) => h.findings).find((f) => f.rule_id === rule);
      assert.ok(found, `${kind}: expected ${rule}, got ${run.body.highlights.flatMap((h) => h.findings).map((f) => f.rule_id)}`);
      assert.ok(found.region.w > 0 && run.body.score < 100);
    }
  } finally { server.close(); await db.close(); }
});
