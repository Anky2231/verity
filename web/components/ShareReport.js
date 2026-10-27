'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, explain } from '../lib/api';

const when = (ts) => new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });

// Managers create and revoke read-only report links for clients. The full link is shown once, right after it is created.
export default function ShareReport({ token, brandName }) {
  const [links, setLinks] = useState([]);
  const [fresh, setFresh] = useState(null);
  const [days, setDays] = useState('14');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setLinks(await api('/share-links', { token })); } catch (e) { setError(explain(e, 'Could not load the report links.')); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true); setError(''); setCopied(false);
    try {
      const made = await api('/share-links', { token, method: 'POST', body: JSON.stringify({ days: Number(days), label: label.trim() || undefined }) });
      setFresh(`${window.location.origin}${made.path}`); setLabel(''); await load();
    } catch (e) { setError(explain(e, 'Could not create the link.')); } finally { setBusy(false); }
  }
  async function revoke(id) {
    setError('');
    try { await api(`/share-links/${id}`, { token, method: 'DELETE' }); setFresh(null); await load(); }
    catch (e) { setError(explain(e, 'Could not revoke the link.')); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(fresh); setCopied(true); } catch { setError('Copy failed. Select the link and copy it by hand.'); }
  }

  return (
    <section className="card" aria-labelledby="share-h">
      <b id="share-h">Share a read-only report with a client</b>
      <p className="muted" style={{ margin: '4px 0 10px' }}>
        Anyone with the link can read a summary of {brandName ?? 'this brand'}: scores, trend, where violations come from and the status of each review.
        It never shows your content, comments or team members’ names. Links expire and can be revoked.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Label <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} placeholder="For example: Acme monthly" style={{ padding: 6 }} /></label>
        <label>Expires after
          <select value={days} onChange={(e) => setDays(e.target.value)} style={{ marginLeft: 6 }}>
            <option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="90">90 days</option>
          </select></label>
        <button className="primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      {fresh && (
        <div role="status" className="card" style={{ marginTop: 10 }}>
          <b>Copy this link now. For safety it is not shown again.</b>
          <input readOnly value={fresh} aria-label="Report link" style={{ width: '100%', padding: 6, marginTop: 6 }} onFocus={(e) => e.target.select()} />
          <button onClick={copy} style={{ marginTop: 6 }}>{copied ? 'Copied' : 'Copy link'}</button>
        </div>)}
      {links.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Label</th><th>Created</th><th>Expires</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{links.map((l) => (
              <tr key={l.id}>
                <td>{l.label ?? <span className="muted">no label</span>}</td><td>{when(l.created_at)}</td><td>{when(l.expires_at)}</td>
                <td><span className={`badge ${l.active ? 'green' : ''}`}>{l.revoked_at ? 'revoked' : l.active ? 'active' : 'expired'}</span></td>
                <td>{l.active && <button onClick={() => revoke(l.id)} aria-label={`Revoke link ${l.label ?? l.id}`}>Revoke</button>}</td>
              </tr>))}</tbody>
          </table>
        </div>)}
    </section>
  );
}
