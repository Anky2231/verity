import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { brandContext } from '../brand.js';
import { verifyChain } from '../audit.js';
import { computeCalibration } from '../calibration.js';

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function governanceRouter({ db }) {
  const r = Router();
  const guard = [requireAuth, brandContext(db), requireRole('manager', 'approver', 'admin')];

  // Without `limit` this returns every row (oldest first). With `limit` it returns { items, next_before_id }: the newest
  // `limit` rows older than `before_id`, still oldest first; pass next_before_id as `before_id` for the next page back.
  r.get('/audit', guard, async (req, res) => {
    const paged = req.query.limit !== undefined;
    const limitN = paged ? Number(req.query.limit) : null;
    if (paged && (!Number.isInteger(limitN) || limitN < 1 || limitN > 1000))
      return res.status(400).json({ error: 'invalid_limit', detail: 'limit must be a whole number from 1 to 1000' });
    const before = req.query.before_id !== undefined ? Number(req.query.before_id) : null;
    if (before !== null && (!paged || !Number.isInteger(before) || before < 1))
      return res.status(400).json({ error: 'invalid_before_id', detail: 'before_id must be a whole number, used together with limit' });
    if (req.query.review_id !== undefined && !Number.isInteger(Number(req.query.review_id)))
      return res.status(400).json({ error: 'invalid_review_id', detail: 'review_id must be a whole number' });
    const params = [req.brand], where = ['brand_id=$1'];
    if (req.query.review_id !== undefined) { params.push(Number(req.query.review_id)); where.push(`review_id=$${params.length}`); }
    if (before !== null) { params.push(before); where.push(`id < $${params.length}`); }
    const cols = 'id, review_id, actor_id, actor_role, action, detail, ts, prev_hash, hash';
    let rows, next = null;
    if (paged) {
      params.push(limitN + 1);
      const newest = await db.query(`SELECT ${cols} FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT $${params.length}`, params);
      const more = newest.length > limitN;
      rows = (more ? newest.slice(0, limitN) : newest).reverse();
      next = more ? rows[0].id : null;
    } else rows = await db.query(`SELECT ${cols} FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id`, params);
    if (req.query.format === 'csv') {
      res.type('text/csv').attachment('verity-audit.csv');
      return res.send(['id,ts,review_id,actor_id,actor_role,action,detail,hash',
        ...rows.map((x) => [x.id, x.ts, x.review_id, x.actor_id, x.actor_role, x.action, JSON.stringify(x.detail), x.hash].map(csvCell).join(','))].join('\n'));
    }
    if (req.query.format === 'json') res.attachment('verity-audit.json');
    res.json(paged ? { items: rows, next_before_id: next } : rows);
  });

  // Round 3 (VisualGuard) groundwork: the route exists and is role-guarded, the feature does not.
  r.post('/brand-assets', guard, (_req, res) => res.status(501).json({ error: 'coming_in_round_3', feature: 'VisualGuard' }));

  r.get('/audit/verify', guard, async (req, res) => res.json(await verifyChain(db, req.brand)));

  // Dashboard numbers + ambiguity detector (rules humans keep overriding are probably unclear).
  r.get('/analytics/summary', guard, async (req, res) => {
    const [byStatus, latest, calib, created, human, approve, trend] = await Promise.all([
      db.query('SELECT status, count(*)::int AS n FROM reviews WHERE brand_id=$1 GROUP BY status', [req.brand]),
      db.query(`SELECT DISTINCT ON (v.review_id) v.review_id, v.score, v.result, r.content_type, u.name AS creator
                FROM revisions v JOIN reviews r ON r.id=v.review_id JOIN users u ON u.id=r.creator_id
                WHERE v.brand_id=$1 ORDER BY v.review_id, v.number DESC`, [req.brand]),
      computeCalibration(db, req.brand),
      db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last_30d FROM reviews WHERE brand_id=$1`, [req.brand]),
      db.query(`SELECT decision, count(*)::int AS n FROM flag_decisions WHERE brand_id=$1 GROUP BY decision`, [req.brand]),
      db.query(`SELECT avg(extract(epoch FROM (a.ts::timestamptz - s.ts::timestamptz)) / 3600) AS hours FROM
                  (SELECT review_id, min(ts) AS ts FROM audit_log WHERE brand_id=$1 AND action='review.submit' GROUP BY review_id) s
                JOIN (SELECT review_id, min(ts) AS ts FROM audit_log WHERE brand_id=$1 AND action IN ('review.approve','review.final_approve') GROUP BY review_id) a USING (review_id)`, [req.brand]),
      db.query(`SELECT to_char(date_trunc('week', r.created_at), 'YYYY-MM-DD') AS week, round(avg(l.score))::int AS score, count(*)::int AS reviews
                FROM reviews r JOIN LATERAL (SELECT score FROM revisions WHERE review_id=r.id ORDER BY number DESC LIMIT 1) l ON true
                WHERE r.brand_id=$1 GROUP BY 1 ORDER BY 1`, [req.brand]),
    ]);
    const tally = (keyFn) => { const o = {}; for (const l of latest) for (const h of l.result?.highlights ?? []) for (const f of h.findings) { const k = keyFn(l, f); o[k] = (o[k] ?? 0) + 1; } return o; };
    const byAgent = tally((_l, f) => f.agent), aiFlags = Object.values(byAgent).reduce((a, b) => a + b, 0);
    const dec = Object.fromEntries(human.map((x) => [x.decision, x.n]));
    const scores = latest.map((l) => l.score).filter((s) => s != null);
    res.json({
      reviews_by_status: Object.fromEntries(byStatus.map((x) => [x.status, x.n])),
      reviews_total: created[0].total, reviews_last_30d: created[0].last_30d,
      avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      avg_hours_to_approve: approve[0]?.hours != null ? +Number(approve[0].hours).toFixed(1) : null,
      ai_vs_human: { ai_flags: aiFlags, manual_flags: dec.manual ?? 0, accepted: dec.accepted ?? 0, disputed: dec.disputed ?? 0, overridden: dec.overridden ?? 0 },
      findings_by_agent: byAgent,
      findings_by_content_type: tally((l) => l.content_type),
      findings_by_creator: tally((l) => l.creator),
      score_trend: trend,
      calibration: calib.details,
      rule_override_rates: calib.details.map((x) => ({ rule_id: x.rule_id, decisions: x.decisions, pushed_back: x.pushed_back,
        override_rate: x.override_rate, ambiguous: x.decisions >= 3 && x.override_rate >= 0.5 })),
    });
  });
  return r;
}
