'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, explain } from '../../lib/api';
import { useSession } from '../../lib/session';
import { STATUS_LABEL, TIPS } from '../../lib/labels';
import { usePageTitle } from '../../lib/title';
import ShareReport from '../../components/ShareReport';

const Stat = ({ label, value, hint }) => (
  <div className="card" style={{ marginBottom: 0 }} title={hint}>
    <div className="muted">{label}</div><div style={{ fontSize: 28, fontWeight: 700 }}>{value ?? '—'}</div>
  </div>);

// Horizontal bars with the value printed next to each label (no colour-only meaning).
function Bars({ data, label }) {
  const rows = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map((r) => r[1]));
  if (!rows.length) return <p className="muted">No data yet.</p>;
  return (
    <div role="list" aria-label={label}>
      {rows.map(([k, v]) => (
        <div key={k} role="listitem" style={{ display: 'grid', gridTemplateColumns: '110px 1fr 36px', gap: 8, alignItems: 'center', margin: '6px 0' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</span>
          <div className="hbar" style={{ width: `${(v / max) * 100}%` }} /><b>{v}</b>
        </div>))}
    </div>);
}

function Trend({ points }) {
  if (!points?.length) return <p className="muted">No data yet.</p>;
  const W = 560, H = 160, P = 28;
  const x = (i) => P + (points.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (points.length - 1));
  const y = (s) => H - P - (s / 100) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.score)}`).join(' ');
  return (
    <>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Average score by week: ${points.map((p) => `${p.week} ${p.score}`).join(', ')}`} style={{ width: '100%', maxWidth: 620 }}>
      {[0, 50, 100].map((g) => <g key={g}><line x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="var(--line)" /><text x={4} y={y(g) + 4} fontSize="10" fill="var(--muted)">{g}</text></g>)}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={p.week}><circle cx={x(i)} cy={y(p.score)} r="3.5" fill="var(--accent)"><title>{`Week of ${p.week}: average score ${p.score} across ${p.reviews} reviews`}</title></circle>
          {(i === 0 || i === points.length - 1 || points.length < 8) && <text x={x(i)} y={H - 8} fontSize="9" textAnchor="middle" fill="var(--muted)">{p.week.slice(5)}</text>}</g>))}
    </svg>
    <details style={{ marginTop: 8 }}>
      <summary className="muted">View the same data as a table</summary>
      <table style={{ width: '100%', maxWidth: 420 }}>
        <caption className="sr-only">Average score by week</caption>
        <thead><tr><th scope="col">Week starting</th><th scope="col">Average score</th><th scope="col">Reviews</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.week}><td>{p.week}</td><td>{p.score}</td><td>{p.reviews}</td></tr>)}</tbody>
      </table>
    </details>
    </>);
}

export default function Dashboard() {
  const { token, role, ready, brand } = useSession();
  usePageTitle('Compliance dashboard');
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setA(await api('/analytics/summary', { token })); setError(''); } catch (e) { setError(explain(e, 'Could not load the dashboard.')); }
  }, [token]);
  useEffect(() => { if (token && ['manager', 'approver', 'admin'].includes(role)) load(); }, [token, role, load]);

  if (!ready) return null;
  if (!token) return <div className="doc"><p>Please <a href="/">choose a demo role</a> first.</p></div>;
  if (!['manager', 'approver', 'admin'].includes(role)) return <div className="doc"><p>The dashboard is for managers and approvers. <a href="/">Switch role</a></p></div>;

  const h = a?.ai_vs_human;
  return (
    <div className="doc">
      <h1 style={{ marginBottom: 4 }}>Compliance dashboard</h1>
      <p className="muted" style={{ marginTop: 0 }}>How content is doing against the brand guidelines, and where reviewers disagree with the AI.</p>
      {error && <div className="toast" role="alert"><span>{error}</span><button onClick={load}>Retry</button></div>}
      {!a && !error && <><div className="skeleton" style={{ height: 80 }} /><div className="skeleton" style={{ height: 160 }} /></>}
      {a && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
            <Stat label="Reviews, last 30 days" value={a.reviews_last_30d} hint={`${a.reviews_total} in total`} />
            <Stat label="Average score" value={a.avg_score != null ? `${a.avg_score}/100` : null} hint={TIPS.score} />
            <Stat label="Avg time to approve" value={a.avg_hours_to_approve != null ? `${a.avg_hours_to_approve} h` : null} hint="From submission to approval" />
            <Stat label="AI flags vs human" value={`${h.ai_flags} / ${h.manual_flags + h.overridden}`} hint="AI flags on the latest drafts, versus flags humans added or overrode" />
          </div>

          <h2>Score trend</h2>
          <div className="card"><Trend points={a.score_trend} /><p className="muted" style={{ marginBottom: 0 }}>Average latest score of reviews, grouped by the week they were created.</p></div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12, marginTop: 12 }}>
            <div className="card" style={{ marginBottom: 0 }}><b>Violations by agent</b><Bars data={a.findings_by_agent} label="Violations by agent" /></div>
            <div className="card" style={{ marginBottom: 0 }}><b>Violations by content type</b><Bars data={a.findings_by_content_type} label="Violations by content type" /></div>
            <div className="card" style={{ marginBottom: 0 }}><b>Violations by creator</b><Bars data={a.findings_by_creator} label="Violations by creator" /></div>
            <div className="card" style={{ marginBottom: 0 }}><b>Reviews by status</b>
              <Bars data={Object.fromEntries(Object.entries(a.reviews_by_status).map(([k, v]) => [STATUS_LABEL[k] ?? k, v]))} label="Reviews by status" /></div>
          </div>

          <h2>Clauses reviewers keep overriding</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <p className="muted" style={{ marginTop: 0 }}>When most decisions on a rule are disputes or overrides, the clause may be unclear. Verity then raises that rule’s confidence cutoff, so borderline findings become suggestions instead of lowering the score.</p>
            {a.calibration.length === 0 ? <p className="muted">No reviewer decisions yet.</p> : (
              <table>
                <thead><tr><th>Rule</th><th>Decisions</th><th>Pushed back</th><th>Override rate</th><th>Confidence cutoff</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{a.calibration.map((c) => (
                  <tr key={c.rule_id}>
                    <td><b>{c.rule_id}</b></td><td>{c.decisions}</td><td>{c.pushed_back}</td>
                    <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div className="hbar" style={{ width: `${c.override_rate * 100}px`, background: c.override_rate >= 0.5 ? 'var(--red)' : 'var(--accent)' }} />{Math.round(c.override_rate * 100)}%</div></td>
                    <td>{Math.round(c.cutoff * 100)}%{c.raised ? ' (raised)' : ''}</td>
                    <td>{a.rule_override_rates.find((r) => r.rule_id === c.rule_id)?.ambiguous && <span className="badge amber">possibly ambiguous</span>}</td>
                  </tr>))}</tbody>
              </table>)}
          </div>
          {['manager', 'admin'].includes(role) && <><h2>Client report</h2><ShareReport token={token} brandName={brand?.name} /></>}
          <p className="muted">Looking for the record of every action? <a href="/audit">Open the audit trail</a>.</p>
        </>)}
    </div>
  );
}
