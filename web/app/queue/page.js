'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, explain } from '../../lib/api';
import { useSession } from '../../lib/session';
import { markProgress } from '../../lib/progress';
import { usePageTitle } from '../../lib/title';
import { ACTION_LABEL, STATUS_LABEL, TIPS, ago } from '../../lib/labels';
import ReasonDialog from '../../components/ReasonDialog';

const PAGE = 25;
const STATUSES = ['', 'draft', 'submitted', 'escalated', 'changes_requested', 'approved', 'published'];

export default function Queue() {
  const { token, user, role, ready } = useSession();
  const [rows, setRows] = useState(null);
  const [more, setMore] = useState(null);          // cursor for the next page, or null when everything is shown
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');          // the search text the list was last loaded for (typing is debounced)
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [reasonRequest, setReasonRequest] = useState(null);
  const staff = role && role !== 'creator';
  usePageTitle(role === 'creator' ? 'My reviews' : 'Review queue');

  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const path = useCallback((limit, cursor) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (status) q.set('status', status);
    if (query) q.set('q', query);
    if (cursor) q.set('cursor', cursor);
    return `/reviews?${q}`;
  }, [status, query]);

  // Loads the list again. After an action it asks for as many rows as are already on screen, so loaded pages do not vanish.
  const refresh = useCallback(async (keep = 0) => {
    try {
      const page = await api(path(Math.min(200, Math.max(PAGE, keep))), { token });
      setRows(page.items); setMore(page.next_cursor); setError('');
    } catch (e) { setError(explain(e, 'Could not load the queue.')); }
  }, [token, path]);
  useEffect(() => { if (token) { setRows(null); refresh(); } }, [token, refresh]);

  async function loadMore() {
    setLoadingMore(true);
    try { const page = await api(path(PAGE, more), { token }); setRows((r) => [...r, ...page.items]); setMore(page.next_cursor); }
    catch (e) { setError(explain(e, 'Could not load more reviews.')); } finally { setLoadingMore(false); }
  }

  // Actions that need a reason open the dialog; it closes either way and a failure shows in the error banner.
  function act(id, a) {
    const run = async (reason) => {
      await api(`/reviews/${id}/transition`, { token, method: 'POST', body: JSON.stringify({ action: a.action, reason }) });
      if (['approve', 'escalate', 'reject'].includes(a.action)) markProgress('approve');
      await refresh(rows?.length);
    };
    if (a.reason) {
      setReasonRequest({
        title: 'Reason required',
        description: `Explain why you want to ${(ACTION_LABEL[a.action] ?? a.action).toLowerCase()}.`,
        onConfirm: async (reason) => {
          try { await run(reason); } catch (e) { setError(explain(e)); } finally { setReasonRequest(null); }
        },
      });
    } else run().catch((e) => setError(explain(e)));
  }

  if (!ready) return null;
  if (!token) return <div className="doc"><p>Please <a href="/">choose a demo role</a> first.</p></div>;

  return (
    <div className="doc">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0 }}>{staff ? 'Review queue' : 'My reviews'}</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {role !== 'approver' && <a href="/review" className="btn primary">+ New review</a>}
          {role !== 'approver' && <a href="/visual" className="btn">+ New image review</a>}
 <input type="search" aria-label="Search titles" placeholder="Search titles" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} style={{ padding: 6, maxWidth: 180 }} />
          <select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? STATUS_LABEL[s] : 'All statuses'}</option>)}
          </select>
        </div>
      </div>
      <p className="muted">Signed in as <b>{user?.name}</b> ({role}). {role === 'approver' ? 'Filter to “Escalated” to see what needs your sign-off.' : role === 'manager' ? 'Filter to “Submitted” to see what needs your decision.' : ''}</p>
      {error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => refresh(rows?.length)}>Retry</button></div>}

      <div className="card" style={{ overflowX: 'auto' }}>
        {rows === null ? <><div className="skeleton" /><div className="skeleton" /><div className="skeleton" style={{ width: '70%' }} /></> :
          rows.length === 0 ? (
            <p className="muted">{query ? `Nothing matches “${query}”.` : status ? 'Nothing with that status.' : 'No reviews yet.'} {role !== 'approver' && <a href="/review">Start a review and load the sample content →</a>}</p>
          ) : (
            <table>
              <thead><tr><th>Title</th><th>Creator</th><th>Status</th><th title={TIPS.score}>Score</th><th>Open flags</th><th title={TIPS.delta}>Δ</th><th>Age</th><th>Actions</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td><a href={`${r.content_type === 'image' ? '/visual' : '/review'}?id=${r.id}`}>{r.title}</a></td>
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
      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0' }}>
          <span className="muted" role="status">Showing {rows.length}{more ? ' (more available)' : ''}</span>
          {more && <button onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
        </div>)}
      {staff && <p className="muted">Compliance numbers are on the <a href="/dashboard">dashboard</a>.</p>}
      <ReasonDialog
        open={Boolean(reasonRequest)}
        title={reasonRequest?.title}
        description={reasonRequest?.description}
        onConfirm={(reason) => reasonRequest?.onConfirm(reason)}
        onCancel={() => setReasonRequest(null)}
      />
    </div>
  );
}
