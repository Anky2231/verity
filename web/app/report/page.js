'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { STATUS_LABEL } from '../../lib/labels';
import { usePageTitle } from '../../lib/title';

const when = (ts) => new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });
const AGENT = { tone: 'Tone', term: 'Terminology', claim: 'Claims', brand: 'Other brand wording', visual: 'Images' };

function Stat({ label, value }) {
  return <div className="card" style={{ marginBottom: 0 }}><div className="muted">{label}</div><div style={{ fontSize: 28, fontWeight: 700 }}>{value ?? '—'}</div></div>;
}

function ReportInner() {
  const token = useSearchParams().get('token');
  const [report, setReport] = useState(null);
  const [state, setState] = useState('loading');
  usePageTitle(report ? `Compliance report: ${report.brand}` : 'Compliance report');

  useEffect(() => {
    if (!token) { setState('missing'); return; }
    api(`/public/report/${encodeURIComponent(token)}`)
      .then((r) => { setReport(r); setState('ok'); })
      .catch((e) => setState(e.status === 404 ? 'invalid' : e.status === 429 ? 'busy' : 'error'));
  }, [token]);

  if (state === 'loading') return <div className="doc"><div className="skeleton" style={{ height: 120 }} /></div>;
  if (state !== 'ok') {
    const text = { missing: 'This page needs a report link.', invalid: 'This report link is not valid. It may have expired or been withdrawn. Ask the person who sent it for a new one.',
      busy: 'Too many requests. Please try again in a minute.', error: 'The report could not be loaded. Please try again in a moment.' }[state];
    return <div className="doc"><h1>Compliance report</h1><p role="alert">{text}</p></div>;
  }

  const r = report;
  return (
    <div className="doc">
      <h1 style={{ marginBottom: 4 }}>Compliance report: {r.brand}</h1>
      <p className="muted" style={{ marginTop: 0 }}>Read-only summary prepared {when(r.generated_at)}. It shows scores and status only, not the content itself.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
        <Stat label="Reviews" value={r.reviews_total} />
        <Stat label="Average score" value={r.avg_score != null ? `${r.avg_score}/100` : null} />
        <Stat label="Approved or published" value={(r.reviews_by_status.approved ?? 0) + (r.reviews_by_status.published ?? 0)} />
        <Stat label="Waiting for review" value={(r.reviews_by_status.submitted ?? 0) + (r.reviews_by_status.escalated ?? 0)} />
      </div>

      <h2>Score by week</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        {r.score_trend.length === 0 ? <p className="muted">No data yet.</p> : (
          <table><thead><tr><th>Week starting</th><th>Average score</th><th>Reviews</th></tr></thead>
            <tbody>{r.score_trend.map((t) => <tr key={t.week}><td>{t.week}</td><td>{t.score}</td><td>{t.reviews}</td></tr>)}</tbody></table>)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
        <div className="card" style={{ marginBottom: 0 }}><b>Open issues by check</b>
          {Object.keys(r.violations_by_agent).length === 0 ? <p className="muted">None.</p> : (
            <table><tbody>{Object.entries(r.violations_by_agent).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{AGENT[k] ?? k}</td><td><b>{v}</b></td></tr>)}</tbody></table>)}</div>
        <div className="card" style={{ marginBottom: 0 }}><b>Most frequent guideline clauses</b>
          {r.top_clauses.length === 0 ? <p className="muted">None.</p> : (
            <table><tbody>{r.top_clauses.map((c) => <tr key={c.clause}><td>{c.clause}</td><td><b>{c.count}</b></td></tr>)}</tbody></table>)}</div>
      </div>

      <h2>Recent reviews</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Score</th><th>Open issues</th><th>Updated</th></tr></thead>
          <tbody>{r.reviews.map((x, i) => (
            <tr key={i}><td>{x.title}</td><td>{x.content_type}</td><td>{STATUS_LABEL[x.status] ?? x.status}</td><td>{x.score ?? '—'}</td><td>{x.open_violations}</td><td>{when(x.updated_at)}</td></tr>))}</tbody>
        </table>
      </div>
      <p className="muted">Prepared with Verity. Every score is the result of automated checks against the brand’s guidelines, reviewed by people before anything is approved.</p>
    </div>
  );
}

export default function ReportPage() { return <Suspense fallback={null}><ReportInner /></Suspense>; }
