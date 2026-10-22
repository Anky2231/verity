import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { decide, nextActions } from '../workflow.js';
import { wordDiff } from '../diff.js';
import fs from 'node:fs';
import { computeCalibration } from '../calibration.js';
import { LruCache, hashKey, rateLimiter } from '../limits.js';
import { notify, idsWithRole } from '../notify.js';

// Precomputed result for the built-in sample only: used (and labelled) if the AI service is unreachable.
const DEMO = JSON.parse(fs.readFileSync(new URL('../../seed/sample_result.json', import.meta.url), 'utf8'));
const norm = (t) => t.normalize('NFC').replace(/\r\n?/g, '\n').trim();

const BRAND = 'lumina'; // single brand in Round 2; every query is already brand-scoped for Round 3
const MAX_TEXT = 20000;
const flagCount = (result) => (result?.highlights ?? []).reduce((n, h) => n + h.findings.length, 0);

export function reviewsRouter({ db, aiFetch, aiStream }) {
  const r = Router();
  const cache = new LruCache(200);
  const limit = rateLimiter(Number(process.env.RUN_LIMIT_PER_MIN || 20), 60000);
  r.use(requireAuth);

  // Load a review the caller may see. Creators only see their own.
  async function load(req, res) {
    const [rev] = await db.query('SELECT * FROM reviews WHERE id=$1 AND brand_id=$2', [req.params.id, BRAND]);
    if (!rev || (req.user.role === 'creator' && rev.creator_id !== req.user.sub)) {
      res.status(404).json({ error: 'not_found' });
      return null;
    }
    return rev;
  }
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'server_error' }); });

  r.post('/', requireRole('creator', 'manager', 'admin'), wrap(async (req, res) => {
    const title = String(req.body?.title ?? '').trim().slice(0, 200) || 'Untitled';
    const [big] = await db.query('SELECT max(version) AS v FROM big_versions WHERE brand_id=$1', [BRAND]);
    const [row] = await db.query(
      `INSERT INTO reviews (brand_id, big_version, title, content_type, creator_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [BRAND, big.v, title, req.body?.content_type || 'blog', req.user.sub]);
    await audit(db, { brandId: BRAND, reviewId: row.id, actor: req.user, action: 'review.created', detail: { title } });
    res.status(201).json(row);
  }));

  r.get('/', wrap(async (req, res) => {
    const own = req.user.role === 'creator' ? 'AND r.creator_id = $2' : 'AND $2::text IS NOT NULL';
    const rows = await db.query(
      `SELECT r.*, u.name AS creator_name,
         (SELECT jsonb_build_object('number', v.number, 'score', v.score, 'flags', v.result) FROM revisions v
            WHERE v.review_id=r.id ORDER BY v.number DESC LIMIT 1) AS latest,
         (SELECT v.result FROM revisions v WHERE v.review_id=r.id ORDER BY v.number DESC OFFSET 1 LIMIT 1) AS prev
       FROM reviews r JOIN users u ON u.id=r.creator_id
       WHERE r.brand_id=$1 ${own} ${req.query.status ? 'AND r.status=$3' : ''}
       ORDER BY r.updated_at DESC`,
      req.query.status ? [BRAND, req.user.sub, req.query.status] : [BRAND, req.user.sub]);
    res.json(rows.map(({ latest, prev, ...x }) => ({
      ...x, latest_revision: latest?.number ?? null, score: latest?.score ?? null, flag_count: latest ? flagCount(latest.flags) : 0,
      delta: latest && prev ? flagCount(latest.flags) - flagCount(prev) : null,
      actions: nextActions(x.status, req.user.role) })));
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
  async function execute(rev, text, emit) {
    const [big] = await db.query('SELECT data FROM big_versions WHERE brand_id=$1 AND version=$2', [BRAND, rev.big_version]);
    const calibration = await computeCalibration(db, BRAND);
    const key = hashKey(BRAND, rev.big_version, JSON.stringify(calibration.cutoffs), norm(text));
    const hit = cache.get(key);
    if (hit) { hit.agents.forEach((a) => emit?.('agent', a)); return { result: { ...hit, cached: true }, source: 'cache' }; }
    const body = { revision_id: `rev_${rev.id}`, brand_id: BRAND, big_version: rev.big_version, content_type: rev.content_type,
      text, big: big.data, calibration: calibration.cutoffs };
    try {
      let result;
      if (emit) {
        const res = await aiStream('/stream/review', body);
        let buf = '';
        for await (const chunk of res.body) {
          buf += Buffer.from(chunk).toString('utf8');
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line) continue;
            const ev = JSON.parse(line);
            if (ev.event === 'agent') emit('agent', ev.result);
            else if (ev.event === 'done') result = ev.result;
            else if (ev.event === 'error') throw new Error(ev.error);
          }
        }
        if (!result) throw new Error('ai_incomplete');
      } else result = await aiFetch('/review', { method: 'POST', body: JSON.stringify(body) });
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
      [rev.id, BRAND, result.text, result.score, JSON.stringify(result)]);
    await db.query('UPDATE reviews SET updated_at=now() WHERE id=$1', [rev.id]);
    await audit(db, { brandId: BRAND, reviewId: rev.id, actor: req.user, action: 'review.ran',
      detail: { revision: row.number, score: result.score, flags: flagCount(result), big_version: rev.big_version, source,
        timing: result.timing, agents: (result.agents ?? []).map((a) => ({ agent: a.agent, status: a.status, mode: a.mode, model: a.model, latency_ms: a.latency_ms, retries: a.retries })) } });
    return row.number;
  }

  // Shared pre-checks for both run endpoints. Returns { rev, text } or null (response already sent).
  async function prepareRun(req, res) {
    const rev = await load(req, res); if (!rev) return null;
    if (!['draft', 'changes_requested'].includes(rev.status)) { res.status(409).json({ error: 'invalid_state', detail: 'review is locked while in approval' }); return null; }
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
    try { out = await execute(p.rev, p.text); } catch { return res.status(502).json({ error: 'ai_unavailable' }); }
    const revision = await store(p.rev, req, out.result, out.source);
    res.json({ revision, ...out.result });
  }));

  // Same, streamed as server-sent events: one `agent` event per finished agent, then `done` with the stored revision.
  r.post('/:id/run/stream', requireRole('creator', 'manager', 'admin'), wrap(async (req, res) => {
    const p = await prepareRun(req, res); if (!p) return;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const out = await execute(p.rev, p.text, emit);
      const revision = await store(p.rev, req, out.result, out.source);
      emit('done', { revision, ...out.result });
    } catch { emit('error', { error: 'ai_unavailable' }); }
    res.end();
  }));

  // Human decision on one AI flag (or a manually added one). Dispute/override require a reason.
  r.post('/:id/decisions', wrap(async (req, res) => {
    const rev = await load(req, res); if (!rev) return;
    const b = req.body ?? {};
    const ok = { creator: ['accepted', 'disputed'], manager: ['accepted', 'disputed', 'overridden', 'manual'],
      approver: ['overridden', 'manual'], admin: ['accepted', 'disputed', 'overridden', 'manual'] };
    if (!ok[req.user.role].includes(b.decision)) return res.status(403).json({ error: 'forbidden' });
    if (['disputed', 'overridden'].includes(b.decision) && !String(b.reason ?? '').trim())
      return res.status(400).json({ error: 'reason_required' });
    if (!b.flag_key || !Number.isInteger(b.revision)) return res.status(400).json({ error: 'flag_key_and_revision_required' });
    const [d] = await db.query(
      `INSERT INTO flag_decisions (review_id, revision_number, brand_id, flag_key, rule_id, agent, quoted_text, decision, reason, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [rev.id, b.revision, BRAND, String(b.flag_key), b.rule_id ?? null, b.agent ?? null, b.quoted_text ?? null, b.decision, b.reason ?? null, req.user.sub]);
    await audit(db, { brandId: BRAND, reviewId: rev.id, actor: req.user, action: `flag.${b.decision}`,
      detail: { revision: b.revision, flag_key: b.flag_key, rule_id: b.rule_id, agent: b.agent, reason: b.reason } });
    res.status(201).json(d);
  }));

  r.post('/:id/comments', wrap(async (req, res) => {
    const rev = await load(req, res); if (!rev) return;
    const body = String(req.body?.body ?? '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'body_required' });
    const [c] = await db.query('INSERT INTO comments (review_id, brand_id, author_id, body) VALUES ($1,$2,$3,$4) RETURNING *', [rev.id, BRAND, req.user.sub, body]);
    await audit(db, { brandId: BRAND, reviewId: rev.id, actor: req.user, action: 'comment.added', detail: { comment_id: c.id } });
    res.status(201).json(c);
  }));

  r.post('/:id/transition', wrap(async (req, res) => {
    const rev = await load(req, res); if (!rev) return;
    const { action, reason } = req.body ?? {};
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
    await audit(db, { brandId: BRAND, reviewId: rev.id, actor: req.user, action: `review.${action}`, detail: { from: rev.status, to: d.rule.to, reason } });
    if (reason) await db.query('INSERT INTO comments (review_id, brand_id, author_id, body) VALUES ($1,$2,$3,$4)', [rev.id, BRAND, req.user.sub, `[${action}] ${String(reason).slice(0, 1900)}`]);
    const who = req.user.name ?? req.user.role, t = `“${rev.title}”`;
    const msg = { submit: [`${who} submitted ${t} for approval`, ['manager', 'admin']],
      approve: [`${t} was approved`, null], reject: [`${t} needs changes: ${reason ?? ''}`, null],
      escalate: [`${t} was escalated for final approval`, ['approver']],
      final_approve: [`${t} received final approval`, null], send_back: [`${t} was sent back: ${reason ?? ''}`, null],
      publish: [`${t} was marked as published`, null] }[action];
    if (msg) await notify(db, { brandId: BRAND, reviewId: rev.id, message: msg[0].slice(0, 300),
      userIds: msg[1] ? await idsWithRole(db, msg[1]) : [rev.creator_id] });
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
