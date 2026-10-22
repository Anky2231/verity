// Learning loop: a rule that reviewers keep disputing or overriding gets a higher confidence cutoff,
// so its borderline findings become "suggestions" instead of penalised violations.
export const MIN_DECISIONS = 5, PUSHBACK = 0.5, RAISED_CUTOFF = 0.75, DEFAULT_CUTOFF = 0.6;

export async function computeCalibration(db, brandId) {
  const rows = await db.query(
    `SELECT rule_id, count(*)::int AS decisions,
       count(*) FILTER (WHERE decision IN ('disputed','overridden'))::int AS pushed_back
     FROM flag_decisions WHERE brand_id=$1 AND rule_id IS NOT NULL GROUP BY rule_id ORDER BY 2 DESC`, [brandId]);
  const details = rows.map((x) => {
    const rate = x.pushed_back / x.decisions;
    const raised = x.decisions >= MIN_DECISIONS && rate >= PUSHBACK;
    return { rule_id: x.rule_id, decisions: x.decisions, pushed_back: x.pushed_back, override_rate: +rate.toFixed(2),
      cutoff: raised ? RAISED_CUTOFF : DEFAULT_CUTOFF, raised };
  });
  return { cutoffs: Object.fromEntries(details.filter((d) => d.raised).map((d) => [d.rule_id, d.cutoff])), details };
}
