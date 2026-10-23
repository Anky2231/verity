'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, explain } from '../../lib/api';
import { useSession } from '../../lib/session';
import { markProgress } from '../../lib/progress';
import { usePageTitle } from '../../lib/title';

const SEVS = ['low', 'medium', 'high', 'critical'];
const csv = (a) => (a ?? []).join(', ');
const lines = (a) => (a ?? []).join('\n');
const split = (s, re) => s.split(re).map((x) => x.trim()).filter(Boolean);
const nextId = (list, p) => `${p}_${Math.max(0, ...list.map((x) => Number(String(x.id).split('_').pop()) || 0)) + 1}`;

export default function Brand() {
  const { token, role, ready } = useSession();
  usePageTitle('Brand guidelines');
  const [info, setInfo] = useState(null);
  const [draft, setDraft] = useState(null);   // editable BIG being previewed
  const [notes, setNotes] = useState([]);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const file = useRef(null);
  const allowed = ['manager', 'admin'].includes(role);

  const load = useCallback(async () => {
    try { setInfo(await api('/brand', { token })); setError(''); } catch (e) { setError(explain(e, 'Could not load the brand.')); }
  }, [token]);
  useEffect(() => { if (token && ['manager', 'approver', 'admin'].includes(role)) load(); }, [token, role, load]);

  async function extract(body) {
    setBusy(true); setError(''); setMsg(''); setErrors([]);
    try {
      const out = await api('/brand/extract', { token, method: 'POST', body: JSON.stringify(body) });
      setDraft(out.big); setNotes(out.notes); markProgress('guideline');
    } catch (e) { setError(explain(e)); } finally { setBusy(false); }
  }
  function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 5_000_000) { setError('That file is over 5 MB.'); return; }
    const rd = new FileReader();
    rd.onload = () => extract({ filename: f.name, content_base64: String(rd.result).split(',')[1] });
    rd.readAsDataURL(f);
    e.target.value = '';
  }
  async function publish() {
    setBusy(true); setError(''); setErrors([]);
    try {
      const out = await api('/brand/publish', { token, method: 'POST', body: JSON.stringify({ big: draft }) });
      setMsg(`Published as version ${out.version}: ${out.rules} rules, ${out.terms} terms, ${out.claims} claims. New reviews now use it.`);
      setDraft(null); setNotes([]); markProgress('guideline'); load();
    } catch (e) {
      if (e.body?.errors) setErrors(e.body.errors); else setError(explain(e));
    } finally { setBusy(false); }
  }

  const set = (key, i, patch) => setDraft((d) => ({ ...d, [key]: d[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const del = (key, i) => setDraft((d) => ({ ...d, [key]: d[key].filter((_, j) => j !== i) }));
  const add = (key, item) => setDraft((d) => ({ ...d, [key]: [...d[key], item] }));

  if (!ready) return null;
  if (!token) return <div className="doc"><p>Please <a href="/">choose a demo role</a> first.</p></div>;
  if (!['manager', 'approver', 'admin'].includes(role)) return <div className="doc"><p>Guidelines are managed by managers. <a href="/">Switch role</a></p></div>;

  return (
    <div className="doc">
      <h1 style={{ marginBottom: 4 }}>Brand guidelines</h1>
      <p className="muted" style={{ marginTop: 0 }}>Upload a guideline and Verity turns it into rules, approved terms and approved claims. You review everything before it goes live.</p>
      {error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => { setError(''); load(); }}>Retry</button></div>}
      {msg && <p role="status" className="badge green" style={{ padding: '6px 10px' }}>{msg}</p>}

      {!info ? <><div className="skeleton" /><div className="skeleton" style={{ width: '60%' }} /></> : (
        <div className="card">
          <b>{info.brand?.name}</b> · current version <b>v{info.versions[0]?.version}</b>
          <span className="muted"> · {info.versions[0]?.rules} rules, {info.versions[0]?.terms} terms, {info.versions[0]?.claims} claims</span>
          <details style={{ marginTop: 8 }}><summary className="muted">Version history ({info.versions.length})</summary>
            <ul>{info.versions.map((v) => <li key={v.version}>v{v.version} · {new Date(v.created_at).toLocaleDateString()} · {v.created_by ?? 'system'} · {v.rules} rules, {v.terms} terms, {v.claims} claims</li>)}</ul>
          </details>
        </div>)}

      {allowed && !draft && (
        <div className="card">
          <b>Add or update guidelines</b>
          <p className="muted" style={{ margin: '4px 0 10px' }}>PDF, DOCX, TXT or MD, up to 5 MB. Nothing is saved until you publish.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input ref={file} type="file" accept=".pdf,.docx,.txt,.md" onChange={onFile} disabled={busy} aria-label="Guideline file" />
            <button className="primary" onClick={() => extract({ use_sample: true, filename: 'sample.md' })} disabled={busy}>{busy ? 'Reading…' : 'Use sample guideline'}</button>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>Sample files to try: <a href="/sample/lumina-brand-guidelines.pdf" download>PDF</a> · <a href="/sample/lumina-brand-guidelines.docx" download>DOCX</a> · <a href="/sample/lumina-brand-guidelines.md" download>MD</a></p>
        </div>)}
      {!allowed && <p className="muted">Only managers can change guidelines. You can see the current version above.</p>}

      {draft && (
        <section aria-label="Extraction preview">
          <h2>Preview what was extracted</h2>
          <p className="muted">Edit, delete or add anything. Publishing creates a new version; earlier versions are kept.</p>
          {notes.length > 0 && (
            <div className="card" style={{ borderColor: '#b45309' }}><b>Check these</b><ul style={{ margin: '6px 0 0' }}>{notes.map((n) => <li key={n}>{n}</li>)}</ul></div>)}
          {errors.length > 0 && (
            <div className="toast" role="alert" style={{ display: 'block' }}><b>Fix these before publishing</b><ul style={{ margin: '6px 0 0' }}>{errors.map((n) => <li key={n}>{n}</li>)}</ul></div>)}

          <div className="card">
            <b>Voice</b>
            <label className="muted" style={{ display: 'block', marginTop: 6 }}>Descriptors (comma separated)
              <input style={{ width: '100%', boxSizing: 'border-box' }} value={csv(draft.tone_profile.descriptors)}
                onChange={(e) => setDraft({ ...draft, tone_profile: { ...draft.tone_profile, descriptors: split(e.target.value, /,/) } })} /></label>
            <label className="muted" style={{ display: 'block', marginTop: 6 }}>On-brand examples (one per line)
              <textarea rows={2} defaultValue={lines(draft.tone_profile.do_examples)}
                onBlur={(e) => setDraft({ ...draft, tone_profile: { ...draft.tone_profile, do_examples: split(e.target.value, /\n/) } })} /></label>
            <label className="muted" style={{ display: 'block', marginTop: 6 }}>Off-brand examples (one per line)
              <textarea rows={2} defaultValue={lines(draft.tone_profile.dont_examples)}
                onBlur={(e) => setDraft({ ...draft, tone_profile: { ...draft.tone_profile, dont_examples: split(e.target.value, /\n/) } })} /></label>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <b>Rules ({draft.rules.length})</b>
            <table style={{ width: '100%' }}><thead><tr><th>Clause</th><th>Type</th><th>Severity</th><th>Rule</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{draft.rules.map((r, i) => (
                <tr key={r.id}>
                  <td><input aria-label="Clause" style={{ width: 100 }} value={r.clause_ref} onChange={(e) => set('rules', i, { clause_ref: e.target.value })} /></td>
                  <td><select aria-label="Type" value={r.type} onChange={(e) => set('rules', i, { type: e.target.value })}><option>tone</option><option>claim</option></select></td>
                  <td><select aria-label="Severity" value={r.severity} onChange={(e) => set('rules', i, { severity: e.target.value })}>{SEVS.map((s) => <option key={s}>{s}</option>)}</select></td>
                  <td><textarea aria-label="Rule text" rows={2} style={{ minWidth: 260 }} value={r.text} onChange={(e) => set('rules', i, { text: e.target.value })} /></td>
                  <td><button onClick={() => del('rules', i)} aria-label={`Delete rule ${r.id}`}>Delete</button></td>
                </tr>))}</tbody></table>
            <button onClick={() => add('rules', { id: nextId(draft.rules, 'r_voice'), clause_ref: 'Voice §', type: 'tone', severity: 'medium', text: '' })}>+ Add rule</button>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <b>Approved terms ({draft.glossary.length})</b>
            <table style={{ width: '100%' }}><thead><tr><th>Approved</th><th>Banned variants (comma separated)</th><th>Allowed contexts (comma separated)</th><th>Reason</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{draft.glossary.map((g, i) => (
                <tr key={g.id}>
                  <td><input aria-label="Approved term" value={g.approved} onChange={(e) => set('glossary', i, { approved: e.target.value })} /></td>
                  <td><input aria-label="Banned variants" defaultValue={csv(g.banned)} onBlur={(e) => set('glossary', i, { banned: split(e.target.value, /,/) })} /></td>
                  <td><input aria-label="Allowed contexts" placeholder="e.g. Java developers" defaultValue={csv(g.allowed_contexts)} onBlur={(e) => set('glossary', i, { allowed_contexts: split(e.target.value, /,/) })} /></td>
                  <td><input aria-label="Reason" style={{ minWidth: 220 }} value={g.reason} onChange={(e) => set('glossary', i, { reason: e.target.value })} /></td>
                  <td><button onClick={() => del('glossary', i)} aria-label={`Delete term ${g.id}`}>Delete</button></td>
                </tr>))}</tbody></table>
            <button onClick={() => add('glossary', { id: nextId(draft.glossary, 't'), approved: '', banned: [], reason: '' })}>+ Add term</button>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <b>Approved claims ({draft.claims.length})</b>
            <table style={{ width: '100%' }}><thead><tr><th>Claim</th><th>Source document</th><th>Page</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{draft.claims.map((c, i) => (
                <tr key={c.id}>
                  <td><input aria-label="Claim" style={{ minWidth: 280 }} value={c.text} onChange={(e) => set('claims', i, { text: e.target.value })} /></td>
                  <td><input aria-label="Source document" value={c.source_doc} onChange={(e) => set('claims', i, { source_doc: e.target.value })} /></td>
                  <td><input aria-label="Page" type="number" style={{ width: 70 }} value={c.page ?? ''} onChange={(e) => set('claims', i, { page: e.target.value ? Number(e.target.value) : null })} /></td>
                  <td><button onClick={() => del('claims', i)} aria-label={`Delete claim ${c.id}`}>Delete</button></td>
                </tr>))}</tbody></table>
            <button onClick={() => add('claims', { id: nextId(draft.claims, 'c'), text: '', source_doc: '', page: null })}>+ Add claim</button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={publish} disabled={busy}>{busy ? 'Publishing…' : 'Publish as new version'}</button>
            <button onClick={() => { setDraft(null); setNotes([]); setErrors([]); }} disabled={busy}>Discard</button>
          </div>
        </section>)}

      {info?.current && !draft && (
        <details className="card" open={false}>
          <summary><b>What reviews are checked against (v{info.current.version})</b></summary>
          <p className="muted">Voice: {csv(info.current.tone_profile.descriptors)}</p>
          <ul>{info.current.rules.map((r) => <li key={r.id}><b>{r.clause_ref}</b> ({r.type}, {r.severity}): {r.text}</li>)}</ul>
          <ul>{info.current.glossary.map((g) => <li key={g.id}>Say “{g.approved}”, not {g.banned.map((b) => `“${b}”`).join(' or ')}{g.allowed_contexts?.length ? ` (fine in: ${g.allowed_contexts.join(', ')})` : ''}</li>)}</ul>
          <ul>{info.current.claims.map((c) => <li key={c.id}>{c.text} <span className="muted">({c.source_doc}{c.page ? `, p. ${c.page}` : ''})</span></li>)}</ul>
        </details>)}
    </div>
  );
}
