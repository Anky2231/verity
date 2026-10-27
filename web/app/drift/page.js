'use client';
import { useEffect, useState } from 'react';
import { api, explain } from '../../lib/api';
import { useSession } from '../../lib/session';
import { usePageTitle } from '../../lib/title';
import DriftChart from '../../components/DriftChart';

const STATUS = { drifting: ['Drifting', 'red'], stable: ['Stable', 'green'], insufficient_data: ['Not enough history', ''] };
const ORDER = { drifting: 0, stable: 1, insufficient_data: 2 };

export default function Drift() {
  const { token, role, ready, brand } = useSession();
  usePageTitle('Brand drift');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const allowed = ['manager', 'approver', 'admin'].includes(role);
  useEffect(() => {
    if (!token || !allowed) return;
    api('/drift', { token }).then((x) => { setD(x); setError(''); }).catch((e) => setError(explain(e, 'Could not load the drift analysis.')));
  }, [token, allowed]);

  if (!ready) return null;
  if (!token) return <div className="doc"><p>Please <a href="/">choose a demo role</a> first.</p></div>;
  if (!allowed) return <div className="doc"><p>Brand drift is for managers and approvers. <a href="/">Switch role</a></p></div>;

  const teams = d ? [...d.teams].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.team.localeCompare(b.team)) : [];
  const drifting = teams.filter((t) => t.status === 'drifting');
  return (
    <div className="doc">
      <h1 style={{ marginBottom: 4 }}>Brand drift{brand ? `: ${brand.name}` : ''}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Teams drift from the guidelines slowly, and one review never shows it. Verity compares each team’s violations per 100 words over the last {d?.window_weeks ?? 3} weeks
        with that team’s own first {d?.baseline_weeks ?? 4} weeks, and raises an alert when the rise is both clearly more than chance and at least {d?.min_ratio ?? 1.3} times the baseline.
      </p>
      {error && <div className="toast" role="alert"><span>{error}</span></div>}
      {!d && !error && <div className="skeleton" style={{ height: 160 }} />}
      {d && !d.anchor_week && <div className="card"><p style={{ margin: 0 }}>There are no reviews yet, so there is nothing to compare.</p></div>}
      {d?.anchor_week && (
        <>
          {d.digest && (
            <section className="card" aria-labelledby="digest-h">
              <b id="digest-h">This week’s digest</b>{' '}{d.digest.is_new && <span className="badge amber">new</span>}
              <p style={{ whiteSpace: 'pre-line', margin: '6px 0' }}>{d.digest.text}</p>
              <p className="muted" style={{ margin: 0 }}>Created when the drift view was first opened for the week of {d.digest.week}. Managers were notified once for each drifting team.</p>
            </section>)}

          <h2>Teams</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Team</th><th>Status</th><th>Recent rate</th><th>Baseline rate</th><th>Times baseline</th><th>Score</th><th>Reviews</th></tr></thead>
              <tbody>{teams.map((t) => (
                <tr key={t.team}>
                  <td><b>{t.team}</b></td>
                  <td><span className={`badge ${STATUS[t.status][1]}`}>{STATUS[t.status][0]}</span></td>
                  <td>{t.recent ? t.recent.rate : '—'}</td><td>{t.baseline ? t.baseline.rate : '—'}</td>
                  <td>{t.ratio != null ? `${t.ratio}×` : '—'}</td><td>{t.score ?? '—'}</td><td>{t.reviews}</td>
                </tr>))}</tbody>
            </table>
            <p className="muted" style={{ marginBottom: 0 }}>Rates are violations per 100 words. Score is how many standard errors the recent rate sits above the baseline; an alert needs {d.threshold} or more.</p>
          </div>

          {drifting.length > 0 && <h2>Where the extra violations are</h2>}
          {drifting.map((t) => (
            <section key={t.team} className="card" aria-label={`${t.team} drift`}>
              <b>{t.team}</b> <span className="badge red">Drifting</span>
              <p className="muted" style={{ margin: '4px 0 8px' }}>{t.recent.rate} violations per 100 words over the last {t.recent.weeks} weeks, against a baseline of {t.baseline.rate}.</p>
              {t.rising_clauses.length > 0 ? (
                <>
                  <b>Most likely to be broken next</b>
                  <ul style={{ margin: '4px 0 8px' }}>{t.rising_clauses.map((c) => (
                    <li key={c.clause}>{c.clause}: {c.baseline_rate} → {c.recent_rate} per 100 words ({c.recent_count} recent violations)</li>))}</ul>
                  <p className="muted" style={{ marginTop: 0 }}>This is a trend, not a forecast model: the clauses whose rate is clearly rising are the ones most likely to appear in upcoming reviews.</p>
                </>) : <p className="muted">No single clause stands out; the increase is spread across several.</p>}
              <DriftChart team={t.team} series={t.series} baseline={t.baseline} windowWeeks={d.window_weeks} drifting />
            </section>))}

          <h2>All teams over time</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
            {teams.filter((t) => t.status !== 'drifting').map((t) => (
              <section key={t.team} className="card" aria-label={`${t.team} trend`} style={{ marginBottom: 0 }}>
                <b>{t.team}</b> <span className={`badge ${STATUS[t.status][1]}`}>{STATUS[t.status][0]}</span>
                <DriftChart team={t.team} series={t.series} baseline={t.baseline} windowWeeks={d.window_weeks} />
              </section>))}
          </div>
          <p className="muted">Demo note: the Social team’s drift is planted in the seeded history so there is something to find. Teams are set per brand on each person’s membership.</p>
        </>)}
    </div>
  );
}
