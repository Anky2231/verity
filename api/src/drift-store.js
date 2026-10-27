import { buildDrift, digestText } from './drift.js';
import { notify, idsWithRole } from './notify.js';

const wordsOf = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

// One row per review: its team, the week it was created, its length and its open violations (suggestions are not violations)
// from the latest revision. A person without a team is grouped as "General".
export async function loadDriftInput(db, brandId) {
  const rows = await db.query(
    `SELECT coalesce(m.team, 'General') AS team, to_char(date_trunc('week', r.created_at), 'YYYY-MM-DD') AS week, l.text, l.result
       FROM reviews r
       LEFT JOIN brand_memberships m ON m.user_id = r.creator_id AND m.brand_id = r.brand_id
       JOIN LATERAL (SELECT text, result FROM revisions WHERE review_id = r.id ORDER BY number DESC LIMIT 1) l ON true
      WHERE r.brand_id = $1`, [brandId]);
  return rows.map((r) => {
    const findings = (r.result?.highlights ?? []).flatMap((h) => h.findings ?? []).filter((f) => f.kind !== 'suggestion');
    const clauses = {};
    for (const f of findings) clauses[f.clause_citation] = (clauses[f.clause_citation] ?? 0) + 1;
    return { team: r.team, week: r.week, words: wordsOf(r.text), flags: findings.length, clauses };
  });
}

// The weekly digest. It is stored once per brand and analysis week, and the alerts to managers go out when it is first
// stored, so opening the page ten times in a week notifies nobody twice. There is no background scheduler on free hosting:
// the digest is created the first time anyone opens the drift view in a new week.
export async function ensureDigest(db, brandId, brandName, drift) {
  if (!drift.anchor_week) return null;
  const drifting = drift.teams.filter((t) => t.status === 'drifting');
  const summary = { text: digestText(drift, brandName), drifting: drifting.map((t) => ({ team: t.team, score: t.score, ratio: t.ratio })) };
  const [created] = await db.query(
    'INSERT INTO drift_digests (brand_id, week, summary) VALUES ($1,$2,$3::jsonb) ON CONFLICT (brand_id, week) DO NOTHING RETURNING created_at',
    [brandId, drift.anchor_week, JSON.stringify(summary)]);
  if (created) {
    const managers = await idsWithRole(db, ['manager', 'admin'], brandId);
    for (const t of drifting)
      await notify(db, { brandId, userIds: managers, message: `Drift alert: the ${t.team} team's violation rate is ${t.ratio}x its baseline.` });
    return { week: drift.anchor_week, ...summary, created_at: created.created_at, is_new: true };
  }
  const [row] = await db.query('SELECT summary, created_at FROM drift_digests WHERE brand_id=$1 AND week=$2', [brandId, drift.anchor_week]);
  return { week: drift.anchor_week, ...row.summary, created_at: row.created_at, is_new: false };
}

export async function driftFor(db, brandId, brandName) {
  const drift = buildDrift(await loadDriftInput(db, brandId));
  return { ...drift, digest: await ensureDigest(db, brandId, brandName, drift) };
}
