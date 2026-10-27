// The client-facing compliance report: totals, score trend, where violations come from and a list of reviews.
// It deliberately leaves out review text, comments, user names and ids, so it is safe to show someone outside the team.
const flagsOf = (result) => (result?.highlights ?? []).flatMap((h) => h.findings ?? []);

export async function buildReport(db, brandId) {
  const [brand] = await db.query('SELECT name FROM brands WHERE id=$1', [brandId]);
  const [latest, status, trend] = await Promise.all([
    db.query(`SELECT r.id, r.title, r.content_type, r.status, r.updated_at, l.score, l.result
              FROM reviews r JOIN LATERAL (SELECT score, result FROM revisions WHERE review_id=r.id ORDER BY number DESC LIMIT 1) l ON true
              WHERE r.brand_id=$1 ORDER BY r.updated_at DESC`, [brandId]),
    db.query('SELECT status, count(*)::int AS n FROM reviews WHERE brand_id=$1 GROUP BY status', [brandId]),
    db.query(`SELECT to_char(date_trunc('week', r.created_at), 'YYYY-MM-DD') AS week, round(avg(l.score))::int AS score, count(*)::int AS reviews
              FROM reviews r JOIN LATERAL (SELECT score FROM revisions WHERE review_id=r.id ORDER BY number DESC LIMIT 1) l ON true
              WHERE r.brand_id=$1 GROUP BY 1 ORDER BY 1`, [brandId]),
  ]);
  const byAgent = {}, byClause = {};
  for (const row of latest)
    for (const f of flagsOf(row.result).filter((x) => x.kind !== 'suggestion')) {
      byAgent[f.agent] = (byAgent[f.agent] ?? 0) + 1;
      byClause[f.clause_citation] = (byClause[f.clause_citation] ?? 0) + 1;
    }
  const scores = latest.map((x) => x.score).filter((s) => s != null);
  return {
    brand: brand?.name ?? brandId,
    generated_at: new Date().toISOString(),
    reviews_total: latest.length,
    reviews_by_status: Object.fromEntries(status.map((x) => [x.status, x.n])),
    avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    score_trend: trend,
    violations_by_agent: byAgent,
    top_clauses: Object.entries(byClause).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([clause, count]) => ({ clause, count })),
    reviews: latest.slice(0, 50).map((x) => ({
      title: x.title, content_type: x.content_type, status: x.status, score: x.score,
      open_violations: flagsOf(x.result).filter((f) => f.kind !== 'suggestion').length, updated_at: x.updated_at })),
  };
}
