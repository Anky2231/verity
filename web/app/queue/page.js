'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, explain } from '../../lib/api';
import { useSession } from '../../lib/session';
import { markProgress } from '../../lib/progress';
import { ACTION_LABEL, STATUS_LABEL, TIPS, ago } from '../../lib/labels';
import ReasonDialog from '../../components/ReasonDialog';

const STATUSES = ['', 'draft', 'submitted', 'escalated', 'changes_requested', 'approved', 'published'];

export default function Queue() {
  const { token, user, role, ready } = useSession();
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [reasonRequest, setReasonRequest] = useState(null);
  const staff = role && role !== 'creator';

  const refresh = useCallback(async () => {
    try { setRows(await api(`/reviews${status ? `?status=${status}` : ''}`, { token })); setError(''); }
    catch (e) { setError(explain(e, 'Could not load the queue.')); }
  }, [token, status]);
  useEffect(() => { if (token) refresh(); }, [token, refresh]);

  async function act(id, a) {
  const perform = async (reason) => {
    try {
      await api(`/reviews/${id}/transition`, {
        token,
        method: 'POST',
        body: JSON.stringify({ action: a.action, reason }),
      });

      setReasonRequest(null);

      if (['approve', 'escalate', 'reject'].includes(a.action)) {
        markProgress('approve');
      }

      await refresh();
    } catch (e) {
      setError(explain(e));
    }
  };

  if (a.reason) {
    setReasonRequest({
      title: 'Reason required',
      description: `Explain why you want to ${ACTION_LABEL[a.action] ?? a.action}.`,
      onConfirm: perform,
    });
  } else {
    await perform(undefined);
  }
}
  if (!ready) return null;
  if (!token) return <main className="doc"><p>Please <a href="/">choose a demo role</a> first.</p></main>;

  return (
    <main className="doc">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0 }}>{staff ? 'Review queue' : 'My reviews'}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {role !== 'approver' && <a href="/review"><button className="primary">+ New review</button></a>}
          <select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? STATUS_LABEL[s] : 'All statuses'}</option>)}
          </select>
        </div>
      </div>
      <p className="muted">Signed in as <b>{user?.name}</b> ({role}). {role === 'approver' ? 'Filter to “Escalated” to see what needs your sign-off.' : role === 'manager' ? 'Filter to “Submitted” to see what needs your decision.' : ''}</p>
      {error && <div className="toast" role="alert"><span>{error}</span><button onClick={refresh}>Retry</button></div>}

      <div className="card" style={{ overflowX: 'auto' }}>
        {rows === null ? <><div className="skeleton" /><div className="skeleton" /><div className="skeleton" style={{ width: '70%' }} /></> :
          rows.length === 0 ? (
            <p className="muted">{status ? 'Nothing with that status.' : 'No reviews yet.'} {role !== 'approver' && <a href="/review">Start a review and load the sample content →</a>}</p>
          ) : (
            <table>
              <thead><tr><th>Title</th><th>Creator</th><th>Status</th><th title={TIPS.score}>Score</th><th>Open flags</th><th title={TIPS.delta}>Δ</th><th>Age</th><th>Actions</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td><a href={`/review?id=${r.id}`}>{r.title}</a></td>
                  <td>{r.creator_name}</td>
                  <td><span className="badge">{STATUS_LABEL[r.status] ?? r.status}</span></td>
                  <td>{r.score ?? '—'}</td><td>{r.flag_count}</td>
                  <td title={TIPS.delta} style={{ color: r.delta < 0 ? 'var(--green)' : r.delta > 0 ? 'var(--red)' : undefined }}>{r.delta == null ? '—' : r.delta > 0 ? `+${r.delta}` : r.delta}</td>
                  <td>{ago(r.created_at)}</td>
                  <td><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {r.actions.filter((a) => a.action !== 'submit').map((a) => (
                      <button key={a.action} onClick={() => act(r.id, a)}>{ACTION_LABEL[a.action] ?? a.action}</button>))}
                  </div></td>
                </tr>))}</tbody>
            </table>)}
      </div>
      {staff && <p className="muted">Compliance numbers are on the <a href="/dashboard">dashboard</a>.</p>}
      <ReasonDialog
  open={Boolean(reasonRequest)}
  title={reasonRequest?.title}
  description={reasonRequest?.description}
  onConfirm={(reason) => reasonRequest?.onConfirm(reason)}
  onCancel={() => setReasonRequest(null)}
/>
    </main>
  );
}
