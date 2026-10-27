import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { brandContext, siblingBrands } from '../brand.js';
import { audit } from '../audit.js';
import { decide, nextActions } from '../workflow.js';
import { wordDiff } from '../diff.js';
import fs from 'node:fs';
import { computeCalibration } from '../calibration.js';
import { LruCache, hashKey, rateLimiter } from '../limits.js';
import { notify, idsWithRole } from '../notify.js';
import { validateNewReview, validateComment, validateDecision, validateReason, readImageUpload, MAX_IMAGE_BYTES } from '../validate.js';
import crypto from 'node:crypto';

// Precomputed result for the built-in sample only: used (and labelled) if the AI service is unreachable.
const DEMO = JSON.parse(fs.readFileSync(new URL('../../seed/sample_result.json', import.meta.url), 'utf8'));
const norm = (t) => t.normalize('NFC').replace(/\r\n?/g, '\n').trim();

const MAX_TEXT = 20000;
const encodeCursor = (row) => Buffer.from(JSON.stringify({ t: new Date(row.updated_at).toISOString(), id: Number(row.id) })).toString('base64url');
function decodeCursor(c) {
  try { const o = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')); return Number.isInteger(o.id) && !Number.isNaN(Date.parse(o.t)) ? o : null; }
  catch { return null; }
}
const flagCount = (result) => (result?.highlights ?? []).reduce((n, h) => n + h.findings.length, 0);

export function reviewsRouter({ db, aiFetch, aiStream, reviewQueue }) {
  const r = Router();
  const cache = new LruCache(200);
  let queueDownUntil = 0; // circuit breaker: skip the queue briefly after it fails
  const limit = rateLimiter(Number(process.env.RUN_LIMIT_PER_MIN || 20), 60000);
  r.use(requireAuth, brandContext(db));

  // Load a review the caller may see. Creators only see their own.
  async function load(req, res) {
    const [rev] = await db.query('SELECT * FROM reviews WHERE id=$1 AND brand_id=$2', [req.params.id, req.brand]);
    if (!rev || (req.user.role === 'creator' && rev.creator_id !== req.user.sub)) {
      res.status(404).json({ error: 'not_found' });
      return null;
    }
    return rev;
  }
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'server_error' }); });

  r.post('/', requireRole('creator', 'manager', 'admin'), wrap(async (req, res) => {
    const invalid = validateNewReview(req.body); if (invalid) return res.status(400).json(invalid);
    const title = String(req.body?.title ?? '').trim() || 'Untitled';
    const [big] = await db.query('SELECT max(version) AS v FROM big_versions WHERE brand_id=$1', [req.brand]);
    const [row] = await db.query(
      `INSERT INTO reviews (brand_id, big_version, title, content_type, creator_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.brand, big.v, title, req.body?.content_type ?? 'blog', req.user.sub]);
    await audit(db, { brandId: req.brand, reviewId: row.id, actor: req.user, action: 'review.created', detail: { title } });
    res.status(201).json(row);
  }));

  // Without `limit` this returns every review as a plain array (what the web app uses). With `limit` it returns
  // { items, next_cursor } in keyset pages: pass next_cursor back as `cursor` for the following page.
  r.get('/', wrap(async (req, res) => {
    const paged = req.query.limit !== undefined;
    const limitN = paged ? Number(req.query.limit) : null;
    if (paged && (!Number.isInteger(limitN) || limitN < 1 || limitN > 200))
      return res.status(400).json({ error: 'invalid_limit', detail: 'limit must be a whole number from 1 to 200' });
    let after = null;
    if (req.query.cursor !== undefined) {
      after = decodeCursor(String(req.query.cursor));
      if (!paged || !after) return res.status(400).json({ error: 'invalid_cursor', detail: 'cursor must be a next_cursor value returned with a limit' });
    }
    const params = [req.brand, req.user.sub];
    const where = [`r.brand_id=$1`, req.user.role === 'creator' ? 'r.creator_id = $2' : '$2::text IS NOT NULL'];
    if (req.query.status) { params.push(req.query.status); where.push(`r.status=$${params.length}`); }
    if (after) { params.push(after.t, after.id); where.push(`(r.updated_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`); }
    if (paged) params.push(limitN + 1);
    const rows = await db.query(
      `SELECT r.*, u.name AS creator_name,
         (SELECT jsonb_build_object('number', v.number, 'score', v.score, 'flags', v.result) FROM revisions v
            WHERE v.review_id=r.id ORDER BY v.number DESC LIMIT 1) AS latest,
         (SELECT v.result FROM revisions v WHERE v.review_id=r.id ORDER BY v.number DESC OFFSET 1 LIMIT 1) AS prev
       FROM reviews r JOIN users u ON u.id=r.creator_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.updated_at DESC, r.id DESC${paged ? ` LIMIT $${params.length}` : ''}`, params);
    const more = paged && rows.length > limitN;
    const page = more ? rows.slice(0, limitN) : rows;
    const items = page.map(({ latest, prev, ...x }) => ({
      ...x, latest_revision: latest?.number ?? null, score: latest?.score ?? null, flag_count: latest ? flagCount(latest.flags) : 0,
      delta: latest && prev ? flagCount(latest.flags) - flagCount(prev) : null,
      actions: nextActions(x.status, req.user.role) }));
    if (!paged) return res.json(items);
    res.json({ items, next_cursor: more ? encodeCursor(page[page.length - 1]) : null });
  }));

  r.get('/:id', wrap(async (req, res) => {
    const rev = await load(req, res); if (!rev) return;
    const [revisions, decisions, comments] = await Promise.all([
      db.query('SELECT number, text, score, result, created_at FROM revisions WHERE review_id=$1 ORDER BY number', [rev.id]),
      db.query('SELECT d.*, u.name AS actor_name FROM flag_decisions d JOIN users u ON u.id=d.actor_id WHERE review_id=$1 ORDER BY d.id', [rev.id]),
      db.query('SELECT c.*, u.name AS author_name, u.role AS author_role FROM comments c JOIN users u ON u.id=c.author_id WHERE review_id=$1 ORDER BY c.id', [rev.id]),
    ]);
    const [cu] = await db.query('SELECT name FROM users WHERE id=$1', [rev.creator_id]);
    res.json({ ...rev, creator_name: cu?.name, revisions, decisions, comments, actions: nextActions(rev.status, req.user.role) });
  }));

  // Runs the agents (or serves the cache / the labelled demo fallback). `emit` streams per-agent progress.
  async function execute(rev, text, emit, user) {
    const [big] = await db.query('SELECT data FROM big_versions WHERE brand_id=$1 AND version=$2', [rev.brand_id, rev.big_version]);
    const calibration = await computeCalibration(db, rev.brand_id);
    // The user's other brands are checked for wording that slipped across, so they are part of what the result depends on.
    const siblings = await siblingBrands(db, user.sub, rev.brand_id);
    const [{ name: brandName }] = await db.query('SELECT name FROM brands WHERE id=$1', [rev.brand_id]);
    const key = hashKey(rev.brand_id, rev.big_version, JSON.stringify(calibration.cutoffs), JSON.stringify(siblings), norm(text));
    const hit = cache.get(key);
    if (hit) { hit.agents.forEach((a) => emit?.('agent', a)); return { result: { ...hit, cached: true }, source: 'cache' }; }
    const body = { revision_id: `rev_${rev.id}`, brand_id: rev.brand_id, big_version: rev.big_version, content_type: rev.content_type,
      text, big: { ...big.data, brand_name: brandName, other_brands: siblings }, calibration: calibration.cutoffs };
    try {
      let result;
      const direct = async () => {
        if (!emit) return aiFetch('/review', { method: 'POST', body: JSON.stringify(body) });
        const res = await aiStream('/stream/review', body);
        let buf = '', done;
        for await (const chunk of res.body) {
          buf += Buffer.from(chunk).toString('utf8');
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line);
            if (ev.event === 'agent') emit('agent', ev.result);
            else if (ev.event === 'done') done = ev.result;
            else if (ev.event === 'error') throw new Error(ev.error);
          }
        }
        if (!done) throw new Error('ai_incomplete');
        return done;
      };
      if (reviewQueue && Date.now() >= queueDownUntil) {
        try { result = await reviewQueue.run(body, emit); }
        catch (e) {
          // Redis is optional infrastructure: if it is unreachable, use the direct pipeline and skip the queue for a while.
          console.warn(`review queue unavailable (${e.message}); using the direct pipeline for 30 s`);
          queueDownUntil = Date.now() + 30000;
          result = await direct();
        }
      } else result = await direct();
      cache.set(key, result);
      return { result, source: 'ai' };
    } catch (e) {
      if (norm(text) === norm(DEMO.content)) {
        DEMO.result.agents.forEach((a) => emit?.('agent', a));
        return { result: { ...DEMO.result, cached_demo: true }, source: 'demo' };
      }
      throw e;
    }
  }

  async function store(rev, req, result, source) {
    const [row] = await db.query(
      `INSERT INTO revisions (review_id, brand_id, number, text, score, result)
       SELECT $1, $2, coalesce(max(number),0)+1, $3, $4, $5::jsonb FROM revisions WHERE review_id=$1 RETURNING number`,
      [rev.id, rev.brand_id, result.text, result.score, JSON.stringify(result)]);
    await db.query('UPDATE reviews SET updated_at=now() WHERE id=$1', [rev.id]);
    await audit(db, { brandId: rev.brand_id, reviewId: rev.id, actor: req.user, action: 'review.ran',
      detail: { revision: row.number, score: result.score, flags: flagCount(result), big_version: rev.big_version, source,
        timing: result.timing, agents: (result.agents ?? []).map((a) => ({ agent: a.agent, status: a.status, mode: a.mode, model: a.model, latency_ms: a.latency_ms, retries: a.retries })) } });
    return row.number;
  }

  // Shared pre-checks for both run endpoints. Returns { rev, text } or null (response already sent).
  async function prepareRun(req, res) {
    const rev = await load(req, res); if (!rev) return null;
    if (!['draft', 'changes_requested'].includes(rev.status)) { res.status(409).json({ error: 'invalid_state', detail: 'review is locked while in approval' }); return null; }
    if (rev.content_type === 'image') { res.status(400).json({ error: 'image_review', detail: 'this is an image review: upload an image instead of text' }); return null; }
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) { res.status(400).json({ error: 'text_required' }); return null; }
    if (text.length > MAX_TEXT) { res.status(413).json({ error: 'text_too_long' }); return null; }
    const lim = limit(req.user.sub);
    if (!lim.ok) { res.set('retry-after', String(lim.retryAfter)).status(429).json({ error: 'rate_limited', retry_after: lim.retryAfter }); return null; }
    return { rev, text };
  }

  // Run the multi-agent review and store it as the next immutable revision.
  r.post('/:id/run', requireRole('creator', 'manager', 'admin'), wrap(async (req, res) => {
    const p = await prepareRun(req, res); if (!p) return;
    let out;
    try { out = await execute(p.rev, p.text, undefined, req.user); } catch { return res.status(502).json({ error: 'ai_unavailable' }); }
    const revision = await store(p.rev, req, out.result, out.source);
    res.json({ revision, ...out.result });
  }));

  // Same, streamed as server-sent events: one `agent` event per finished agent, then `done` with the stored revision.
  r.post('/:id/run/stream', requireRole('creator', 'manager', 'admin'), wrap(async (req, res) => {
    const p = await prepareRun(req, res); if (!p) return;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const out = await execute(p.rev, p.text, emit, req.user);
      const revision = await store(p.rev, req, out.result, out.source);
      emit('done', { revision, ...out.result });
    } catch { emit('error', { error: 'ai_unavailable' }); }
    res.end();
  }));

  // VisualGuard: check an uploaded image against the brand's logos and palette, and store the result as the next revision.
  r.post('/:id/image', requireRole('creator', 'manager', 'admin'), wrap(async (req, res) => {
    const rev = await load(req, res); if (!rev) return;
    if (rev.content_type !== 'image') return res.status(400).json({ error: 'not_an_image_review', detail: 'create the review with content_type "image"' });
    if (!['draft', 'changes_requested'].includes(rev.status)) return res.status(409).json({ error: 'invalid_state', detail: 'review is locked while in approval' });
    const up = readImageUpload(req.body, MAX_IMAGE_BYTES);
    if (up.error) return res.status(up.status ?? 400).json(up.error);
    const filename = String(req.body.filename ?? 'image').slice(0, 200);
    const lim = limit(req.user.sub);
    if (!lim.ok) return res.set('retry-after', String(lim.retryAfter)).status(429).json({ error: 'rate_limited', retry_after: lim.retryAfter });

    const assets = await db.query(`SELECT id, kind, name, hex, filename, data FROM brand_assets WHERE brand_id=$1 ORDER BY id`, [rev.brand_id]);
    const logo = (a) => ({ id: String(a.id), name: a.name ?? a.filename, data_base64: a.data.toString('base64') });
    const payload = {
      palette: assets.filter((a) => a.kind === 'palette').map((a) => ({ name: a.name, hex: a.hex })),
      logos: assets.filter((a) => a.kind === 'logo').map(logo),
      retired_logos: assets.filter((a) => a.kind === 'retired_logo').map(logo),
    };
    const calibration = await computeCalibration(db, rev.brand_id);
    const key = hashKey('image', rev.brand_id, crypto.createHash('sha256').update(up.bytes).digest('hex'),
      JSON.stringify([payload.palette, payload.logos.map((l) => l.id), payload.retired_logos.map((l) => l.id)]), JSON.stringify(calibration.cutoffs));
    let result = cache.get(key), source = 'cache';
    if (!result) {
      try {
        result = await aiFetch('/visual/review', { method: 'POST', body: JSON.stringify({
          image_base64: up.bytes.toString('base64'), filename, ...payload, calibration: calibration.cutoffs }) });
      } catch (e) {
        if (/ai 4(22|13)/.test(e.message)) return res.status(422).json({ error: 'unreadable_image', detail: 'that file could not be read as an image' });
        return res.status(502).json({ error: 'ai_unavailable' });
      }
      cache.set(key, result); source = 'ai';
    }
    const [row] = await db.query(
      `INSERT INTO revisions (review_id, brand_id, number, text, score, result)
       SELECT $1, $2, coalesce(max(number),0)+1, $3, $4, $5::jsonb FROM revisions WHERE review_id=$1 RETURNING number`,
      [rev.id, rev.brand_id, `[image] ${filename}`, result.score, JSON.stringify({ ...result, text: `[image] ${filename}` })]);
    await db.query('INSERT INTO review_images (review_id, brand_id, revision_number, filename, mime, data, width, height) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [rev.id, rev.brand_id, row.number, filename, up.mime, up.bytes, result.image?.width ?? null, result.image?.height ?? null]);
    await db.query('UPDATE reviews SET updated_at=now() WHERE id=$1', [rev.id]);
    await audit(db, { brandId: rev.brand_id, reviewId: rev.id, actor: req.user, action: 'review.ran',
      detail: { revision: row.number, score: result.score, flags: flagCount(result), kind: 'image', source, filename,
        agents: (result.agents ?? []).map((a) => ({ agent: a.agent, status: a.status, mode: a.mode, latency_ms: a.latency_ms })) } });
    res.json({ revision: row.number, ...result, text: `[image] ${filename}` });
  }));

  // The image behind one revision, for the review page. Same visibility rules as the review itself.
  r.get('/:id/image/:n', wrap(async (req, res) => {
    const rev = await load(req, res); if (!rev) return;
    const [img] = await db.query('SELECT mime, data FROM review_images WHERE review_id=$1 AND revision_number=$2', [rev.id, Number(req.params.n) || 0]);
    if (!img) return res.status(404).json({ error: 'not_found' });
    res.setHeader('content-type', img.mime);   // setHeader, not res.set: Express would append a text charset to an image type
    res.set('cache-control', 'private, max-age=300').send(img.data);
  }));

  // Human decision on one AI flag (or a manually added one). Dispute/override require a reason.
  r.post('/:id/decisions', wrap(async (req, res) => {
    const rev = await load(req, res); if (!rev) return;
    const b = req.body ?? {};
    const ok = { creator: ['accepted', 'disputed'], manager: ['accepted', 'disputed', 'overridden', 'manual'],
      approver: ['overridden', 'manual'], admin: ['accepted', 'disputed', 'overridden', 'manual'] };
    const invalid = validateDecision(b); if (invalid) return res.status(400).json(invalid);
    if (!ok[req.user.role].includes(b.decision)) return res.status(403).json({ error: 'forbidden' });
    if (['disputed', 'overridden'].includes(b.decision) && !String(b.reason ?? '').trim())
      return res.status(400).json({ error: 'reason_required' });
    const [d] = await db.query(
      `INSERT INTO flag_decisions (review_id, revision_number, brand_id, flag_key, rule_id, agent, quoted_text, decision, reason, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [rev.id, b.revision, rev.brand_id, String(b.flag_key), b.rule_id ?? null, b.agent ?? null, b.quoted_text ?? null, b.decision, b.reason ?? null, req.user.sub]);
    await audit(db, { brandId: rev.brand_id, reviewId: rev.id, actor: req.user, action: `flag.${b.decision}`,
      detail: { revision: b.revision, flag_key: b.flag_key, rule_id: b.rule_id, agent: b.agent, reason: b.reason } });
    res.status(201).json(d);
  }));

  r.post('/:id/comments', wrap(async (req, res) => {
    const rev = await load(req, res); if (!rev) return;
    const invalid = validateComment(req.body); if (invalid) return res.status(400).json(invalid);
    const body = req.body.body.trim();
    const [c] = await db.query('INSERT INTO comments (review_id, brand_id, author_id, body) VALUES ($1,$2,$3,$4) RETURNING *', [rev.id, rev.brand_id, req.user.sub, body]);
    await audit(db, { brandId: rev.brand_id, reviewId: rev.id, actor: req.user, action: 'comment.added', detail: { comment_id: c.id } });
    res.status(201).json(c);
  }));

  r.post('/:id/transition', wrap(async (req, res) => {
    const rev = await load(req, res); if (!rev) return;
    const { action, reason } = req.body ?? {};
    const invalidReason = validateReason(reason); if (invalidReason) return res.status(400).json(invalidReason);
    const d = decide(action, rev.status, req.user.role);
    if (!d.ok) return res.status(d.status).json(d);
    if (d.rule.reason && !String(reason ?? '').trim()) return res.status(400).json({ error: 'reason_required' });
    if (action === 'submit') {
      if (req.user.role === 'creator' && rev.creator_id !== req.user.sub) return res.status(403).json({ error: 'forbidden' });
      const [{ n }] = await db.query('SELECT count(*)::int AS n FROM revisions WHERE review_id=$1', [rev.id]);
      if (!n) return res.status(409).json({ error: 'run_review_first' });
    }
    // Four-eyes principle: nobody approves their own content.
    if (['approve', 'final_approve'].includes(action) && rev.creator_id === req.user.sub)
      return res.status(403).json({ error: 'self_approval_forbidden' });
    // Optimistic concurrency: only moves if status is still what we validated against.
    const [row] = await db.query('UPDATE reviews SET status=$1, updated_at=now() WHERE id=$2 AND status=$3 RETURNING *', [d.rule.to, rev.id, rev.status]);
    if (!row) return res.status(409).json({ error: 'state_changed' });
    await audit(db, { brandId: rev.brand_id, reviewId: rev.id, actor: req.user, action: `review.${action}`, detail: { from: rev.status, to: d.rule.to, reason } });
    if (reason) await db.query('INSERT INTO comments (review_id, brand_id, author_id, body) VALUES ($1,$2,$3,$4)', [rev.id, rev.brand_id, req.user.sub, `[${action}] ${String(reason).slice(0, 1900)}`]);
    const who = req.user.name ?? req.user.role, t = `“${rev.title}”`;
    const msg = { submit: [`${who} submitted ${t} for approval`, ['manager', 'admin']],
      approve: [`${t} was approved`, null], reject: [`${t} needs changes: ${reason ?? ''}`, null],
      escalate: [`${t} was escalated for final approval`, ['approver']],
      final_approve: [`${t} received final approval`, null], send_back: [`${t} was sent back: ${reason ?? ''}`, null],
      publish: [`${t} was marked as published`, null] }[action];
    if (msg) await notify(db, { brandId: rev.brand_id, reviewId: rev.id, message: msg[0].slice(0, 300),
      userIds: msg[1] ? await idsWithRole(db, msg[1], rev.brand_id) : [rev.creator_id] });
    res.json({ ...row, actions: nextActions(row.status, req.user.role) });
  }));

  // Diff between two revisions + compliance delta.
  r.get('/:id/diff', wrap(async (req, res) => {
    const rev = await load(req, res); if (!rev) return;
    const [from, to] = [Number(req.query.from), Number(req.query.to)];
    const rows = await db.query('SELECT number, text, score, result FROM revisions WHERE review_id=$1 AND number = ANY($2::int[])', [rev.id, [from, to]]);
    const a = rows.find((x) => x.number === from), b = rows.find((x) => x.number === to);
    if (!a || !b) return res.status(404).json({ error: 'revision_not_found' });
    res.json({ from, to, diff: wordDiff(a.text, b.text),
      delta: { flags_before: flagCount(a.result), flags_after: flagCount(b.result), score_before: a.score, score_after: b.score } });
  }));

  return r;
}
