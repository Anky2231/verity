'use client';
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, API } from '../../lib/api';

const short = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '');
const when = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const roleOf = (t) => { try { return JSON.parse(atob(t.split('.')[1])).role; } catch { return null; } };

function describe(r) {
  const d = r.detail ?? {};
  const bits = [];
  if (d.title) bits.push(`“${d.title}”`);
  if (d.from && d.to) bits.push(`${d.from} → ${d.to}`);
  if (d.score != null) bits.push(`score ${d.score}, ${d.flags} flag(s)`);
  if (d.rule_id) bits.push(`rule ${d.rule_id}`);
  if (d.reason) bits.push(`reason: ${d.reason}`);
  return bits.join(' · ');
}

function AuditInner() {
  const initial = useSearchParams().get('review_id') ?? '';
  const [token, setToken] = useState(undefined);
  const [rows, setRows] = useState([]);
  const [reviewId, setReviewId] = useState(initial);
  const [action, setAction] = useState('');
  const [chain, setChain] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { try { setToken(localStorage.getItem('verity_token')); } catch { setToken(null); } }, []);
  const allowed = token && ['manager', 'approver', 'admin'].includes(roleOf(token));

  const load = useCallback(async () => {
    try { setRows((await api(`/audit${reviewId ? `?review_id=${encodeURIComponent(reviewId)}` : ''}`, { token })).reverse()); setError(''); }
    catch { setError('Could not load the audit trail.'); }
  }, [token, reviewId]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  async function verify() {
    setBusy(true);
    try { setChain(await api('/audit/verify', { token })); } catch { setError('Verification failed to run.'); } finally { setBusy(false); }
  }
  async function download(format) {
    const res = await fetch(`${API}/audit?format=${format}${reviewId ? `&review_id=${encodeURIComponent(reviewId)}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `verity-audit.${format}` }).click(); URL.revokeObjectURL(url);
  }

  const actions = useMemo(() => [...new Set(rows.map((r) => r.action))].sort(), [rows]);
  const shown = action ? rows.filter((r) => r.action === action) : rows;

  if (token === undefined) return null;
  if (!token) return <main style={{ padding: 32 }}><p>Please <a href="/">choose a demo role</a> first.</p></main>;
  if (!allowed) return <main style={{ padding: 32 }}><p>The audit trail is visible to managers and approvers. <a href="/">Switch role</a></p></main>;

  return (
    <main style={{ maxWidth: 1100, margin: '24px auto', padding: '0 16px' }}>
      <p className="muted" style={{ margin: 0 }}><a href="/queue">← Queue</a></p>
      <h1 style={{ margin: '4px 0' }}>Audit trail</h1>
      <p className="muted" style={{ marginTop: 0 }}>Append-only and hash-chained: each entry includes the hash of the one before it, and the database rejects edits or deletes.</p>

      <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="primary" onClick={verify} disabled={busy}>{busy ? 'Verifying…' : 'Verify chain'}</button>
        {chain && <span className={`badge ${chain.ok ? 'green' : 'red'}`} role="status">
          {chain.ok ? `Chain intact · ${chain.checked} entries verified` : `Broken at entry ${chain.brokenAt}`}</span>}
        <span style={{ flex: 1 }} />
        <input aria-label="Review id" placeholder="Review id" value={reviewId} onChange={(e) => setReviewId(e.target.value.replace(/\D/g, ''))}
          style={{ padding: 6, width: 100 }} />
        <select aria-label="Action filter" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">all actions</option>{actions.map((a) => <option key={a}>{a}</option>)}
        </select>
        <button onClick={() => download('csv')}>Export CSV</button>
        <button onClick={() => download('json')}>Export JSON</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      <div className="card" style={{ overflowX: 'auto' }}>
        {shown.length === 0 ? <p className="muted">No entries match.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left' }}><th>#</th><th>When</th><th>Review</th><th>Actor</th><th>Action</th><th>Details</th><th>Hash</th></tr></thead>
            <tbody>{shown.map((r) => (
              <Fragment key={r.id}>
                <tr onClick={() => setOpen(open === r.id ? null : r.id)} style={{ borderTop: '1px solid var(--line)', cursor: 'pointer' }}>
                  <td>{r.id}</td><td style={{ whiteSpace: 'nowrap' }}>{when(r.ts)}</td>
                  <td>{r.review_id ? <a href={`/review?id=${r.review_id}`} onClick={(e) => e.stopPropagation()}>#{r.review_id}</a> : '—'}</td>
                  <td>{r.actor_id?.replace('u_', '') ?? 'system'} <span className="muted">({r.actor_role ?? '—'})</span></td>
                  <td><span className="badge">{r.action}</span></td><td>{describe(r)}</td>
                  <td><code title={r.hash}>{short(r.hash)}</code></td>
                </tr>
                {open === r.id && (
                  <tr><td colSpan={7} style={{ background: 'var(--bg)' }}>
                    <div className="muted">prev <code>{r.prev_hash}</code></div><div className="muted">hash <code>{r.hash}</code></div>
                    <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(r.detail, null, 2)}</pre>
                  </td></tr>)}
              </Fragment>))}</tbody>
          </table>)}
      </div>
    </main>
  );
}

export default function AuditPage() { return <Suspense fallback={null}><AuditInner /></Suspense>; }
