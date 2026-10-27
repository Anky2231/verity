// Weekly violations per 100 words for one team: the line, the team's own baseline (dashed) and the recent window (shaded).
// A table with the same numbers sits under the chart, so the data is not only available as a picture.
const W = 560, H = 170, P = 30;

export default function DriftChart({ team, series, baseline, windowWeeks, drifting }) {
  const rated = series.filter((p) => p.rate != null);
  if (!rated.length) return <p className="muted">No data yet.</p>;
  const max = Math.max(1, ...rated.map((p) => p.rate), baseline?.rate ?? 0) * 1.15;
  const x = (i) => P + (series.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (series.length - 1));
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const line = series.map((p, i) => (p.rate == null ? null : `${x(i)},${y(p.rate)}`)).filter(Boolean).map((pt, i) => `${i ? 'L' : 'M'}${pt}`).join(' ');
  const from = Math.max(0, series.length - windowWeeks), colour = drifting ? 'var(--red)' : 'var(--accent)';
  const label = `${team}: violations per 100 words by week. ${series.map((p) => `${p.week} ${p.rate ?? 'no reviews'}`).join(', ')}.${baseline ? ` Baseline ${baseline.rate}.` : ''}`;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: '100%', maxWidth: 620 }}>
        <rect x={x(from) - 8} y={P - 8} width={x(series.length - 1) - x(from) + 16} height={H - 2 * P + 16} fill="var(--line)" opacity="0.55"><title>{`Recent window: the last ${windowWeeks} weeks`}</title></rect>
        {[0, max / 2, max].map((g) => <g key={g}><line x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="var(--line)" /><text x={4} y={y(g) + 4} fontSize="10" fill="var(--muted)">{g.toFixed(1)}</text></g>)}
        {baseline && <g><line x1={P} x2={W - P} y1={y(baseline.rate)} y2={y(baseline.rate)} stroke="var(--muted)" strokeDasharray="5 4" /><text x={W - P} y={y(baseline.rate) - 4} fontSize="10" textAnchor="end" fill="var(--muted)">baseline {baseline.rate}</text></g>}
        <path d={line} fill="none" stroke={colour} strokeWidth="2" />
        {series.map((p, i) => p.rate != null && (
          <circle key={p.week} cx={x(i)} cy={y(p.rate)} r="3.5" fill={colour}><title>{`Week of ${p.week}: ${p.rate} violations per 100 words across ${p.reviews} reviews`}</title></circle>))}
        {series.map((p, i) => (i === 0 || i === series.length - 1 || series.length < 9) && <text key={p.week} x={x(i)} y={H - 8} fontSize="9" textAnchor="middle" fill="var(--muted)">{p.week.slice(5)}</text>)}
      </svg>
      <details style={{ marginTop: 6 }}>
        <summary className="muted">View the same data as a table</summary>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', maxWidth: 420 }}>
          <caption className="sr-only">{team}: violations per 100 words by week</caption>
          <thead><tr><th scope="col">Week starting</th><th scope="col">Violations per 100 words</th><th scope="col">Reviews</th></tr></thead>
          <tbody>{series.map((p) => <tr key={p.week}><td>{p.week}</td><td>{p.rate ?? '—'}</td><td>{p.reviews}</td></tr>)}</tbody>
        </table>
        </div>
      </details>
    </>
  );
}
