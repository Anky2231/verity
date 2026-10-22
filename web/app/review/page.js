'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { api, postStream, explain } from '../../lib/api';
import { buildSegments, spanToRange } from '../../lib/spanMap';
import { FlagHighlights, flagKey } from '../../components/flagHighlights';
import { useSession } from '../../lib/session';
import { markProgress } from '../../lib/progress';
import { ACTION_LABEL, STATUS_LABEL, TIPS } from '../../lib/labels';
import ReasonDialog from '../../components/ReasonDialog';

const AGENTS = [['tone', 'ToneGuard'], ['term', 'TermGuard'], ['claim', 'ClaimGuard']];
const toHtml = (t) => t.split('\n').map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('');
const flagCount = (r) => (r?.highlights ?? []).reduce((n, h) => n + h.findings.length, 0);
const download = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
};

function ReviewInner() {
  const router = useRouter();
  const idParam = useSearchParams().get('id');
  const { token, role, ready } = useSession();
  const staff = ['manager', 'approver', 'admin'].includes(role);

  const [review, setReview] = useState(null);
  const [revNumber, setRevNumber] = useState(null);
  const [result, setResult] = useState(null);
  const [flags, setFlags] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null); // per-agent progress while a review is running
  const [error, setError] = useState('');
  const [reasonRequest, setReasonRequest] = useState(null);
  const [title, setTitle] = useState('');
  const [samples, setSamples] = useState([]);
  const [comment, setComment] = useState('');
  const [diff, setDiff] = useState({ from: null, to: null, data: null });
  const selectRef = useRef(() => {});
  selectRef.current = (id) => setActiveId(id);

  const editor = useEditor({
    extensions: [StarterKit, FlagHighlights.configure({ onSelect: (id) => selectRef.current(id) })],
    content: '<p>Paste or write your content here, or load a sample.</p>',
    immediatelyRender: false,
  });

  const locked = !!review && !['draft', 'changes_requested'].includes(review.status);
  useEffect(() => { editor?.setEditable(!locked); }, [editor, locked]);

  const paint = useCallback((list, active) => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(flagKey, {
      flags: list.filter((f) => f.state === 'open').map((f) => ({ ...f, active: f.id === active })) }));
  }, [editor]);
  useEffect(() => { paint(flags, activeId); }, [flags, activeId, paint]);

  // Turn an API result into editor highlights (the editor must already hold result.text).
  const applyResult = useCallback((res, number, decisions = []) => {
    const segs = buildSegments(editor.state.doc);
    const decided = new Map(decisions.filter((d) => d.revision_number === number && d.decision !== 'manual').map((d) => [d.flag_key, d.decision]));
    const list = [];
    res.highlights.forEach((h, hi) => h.findings.forEach((f, fi) => {
      const range = f.span && spanToRange(segs, f.span);
      const id = `${hi}-${fi}`;
      if (range) list.push({ id, ...range, severity: f.severity, finding: f, state: decided.has(id) ? decided.get(id) : 'open' });
    }));
    setResult(res); setRevNumber(number); setFlags(list); setActiveId(list.find((f) => f.state === 'open')?.id ?? null);
  }, [editor]);

  const refreshReview = useCallback(async (id) => { const r = await api(`/reviews/${id}`, { token }); setReview(r); return r; }, [token]);

  const load = useCallback(async (id) => {
    const r = await refreshReview(id);
    const last = r.revisions[r.revisions.length - 1];
    if (last) { editor.commands.setContent(toHtml(last.text)); applyResult(last.result, last.number, r.decisions); }
    if (r.revisions.length >= 2) setDiff({ from: r.revisions[r.revisions.length - 2].number, to: last.number, data: null });
  }, [editor, refreshReview, applyResult]);

  useEffect(() => {
    if (!editor || !token || !idParam) return;
    load(idParam).catch(() => setError('Could not open that review. It may not exist, or it belongs to someone else.'));
  }, [editor, token, idParam, load]);
  useEffect(() => { if (token) api('/sample', { token }).then((s) => setSamples(s.samples ?? [])).catch(() => {}); }, [token]);

  // Revision diff, fetched on demand.
  useEffect(() => {
    if (!review || !diff.from || !diff.to || diff.from === diff.to) return;
    api(`/reviews/${review.id}/diff?from=${diff.from}&to=${diff.to}`, { token }).then((d) => setDiff((x) => ({ ...x, data: d }))).catch(() => {});
  }, [review?.id, diff.from, diff.to, token]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadSample(s) {
    editor.commands.setContent(toHtml(s.content));
    if (!title) setTitle(s.id === 'injection' ? 'Prompt-injection test' : 'Lumina spring campaign post');
    setResult(null); setFlags([]); setLive(null); setError('');
  }

  async function run() {
    setBusy(true); setError('');
    setLive({});
    try {
      let rv = review;
      if (!rv) {
        rv = await api('/reviews', { token, method: 'POST', body: JSON.stringify({ title: title || 'Untitled' }) });
        router.replace(`/review?id=${rv.id}`);
      }
      const text = editor.getText({ blockSeparator: '\n' });
      let finished = false;
      await postStream(`/reviews/${rv.id}/run/stream`, { token, body: { text }, onEvent: (ev, data) => {
        if (ev === 'agent') setLive((l) => ({ ...l, [data.agent]: data }));
        if (ev === 'done') finished = true;
        if (ev === 'error') throw new Error('stream');
      } });
      if (!finished) throw new Error('incomplete');
      markProgress('review', { lastReview: rv.id });
      await load(rv.id);
    } catch (e) {
      setError(e?.status ? explain(e) : 'The review did not finish. Your text is safe; please try again.');
    } finally { setBusy(false); setLive(null); }
  }

  const active = useMemo(() => flags.find((f) => f.id === activeId), [flags, activeId]);
  const mark = (id, state) => setFlags((fs) => fs.map((f) => (f.id === id ? { ...f, state } : f)));

  async function decide(f, decision, reason) {
    await api(`/reviews/${review.id}/decisions`, { token, method: 'POST', body: JSON.stringify({
      revision: revNumber, flag_key: f.id, rule_id: f.finding.rule_id, agent: f.finding.agent, quoted_text: f.finding.quoted_text, decision, reason }) });
    mark(f.id, decision);
    markProgress('fix');
    refreshReview(review.id).catch(() => {});
  }
  const rangeOf = (f) => flagKey.getState(editor.state).find().find((d) => d.type.attrs['data-flag'] === f.id);

  async function accept(f) {
    if (!f.finding.replacement) return;
    const deco = rangeOf(f); if (!deco) return;
    editor.chain().focus().insertContentAt({ from: deco.from, to: deco.to }, f.finding.replacement).run();
    try { await decide(f, 'accepted'); } catch (e) { setError(explain(e, 'Could not save that decision.')); }
  }
  function edit(f) {
    const deco = rangeOf(f); if (!deco) return;
    editor.chain().focus().setTextSelection({ from: deco.from, to: deco.to }).run();
  }

  // Opens the reason dialog. It closes whether the action works or not; a failure shows in the page's error banner
  // (a modal would otherwise hide it).
  function askReason({ title, description, failure, run }) {
    setReasonRequest({ title, description, onConfirm: async (reason) => {
      try { await run(reason); } catch (e) { setError(explain(e, failure)); } finally { setReasonRequest(null); }
    } });
  }

  function dispute(f) {
    askReason({
      title: staff ? 'Override flag' : 'Dispute flag',
      description: staff ? 'Explain why you are overriding this flag.' : 'Explain why you disagree with this flag.',
      failure: 'Could not save that decision.',
      run: (reason) => decide(f, staff ? 'overridden' : 'disputed', reason),
    });
  }

  function manualFlag() {
    const { from, to } = editor.state.selection;
    const quoted = editor.state.doc.textBetween(from, to, '\n').trim();
    if (!quoted) { setError('Select the text you want to flag in the editor first.'); return; }
    askReason({
      title: 'Add a manual flag',
      description: `Why should \u201c${quoted.slice(0, 60)}\u201d be flagged?`,
      failure: 'Could not add that flag.',
      run: async (reason) => {
        await api(`/reviews/${review.id}/decisions`, { token, method: 'POST', body: JSON.stringify({
          revision: revNumber ?? 1, flag_key: `m-${Date.now()}`, agent: 'human', quoted_text: quoted.slice(0, 500), decision: 'manual', reason }) });
        await refreshReview(review.id); setError('');
      },
    });
  }

  // Workflow transitions (submit, approve, reject, escalate, ...). Some require a reason.
  function act(action, needsReason) {
    const run = async (reason) => {
      await api(`/reviews/${review.id}/transition`, { token, method: 'POST', body: JSON.stringify({ action, reason }) });
      if (action === 'submit') markProgress('fix');
      if (['approve', 'escalate', 'reject'].includes(action)) markProgress('approve');
      setError(''); await load(review.id);
    };
    if (needsReason) {
      askReason({ title: 'Reason required', description: `Explain why you want to ${(ACTION_LABEL[action] ?? action).toLowerCase()}.`, failure: 'That action failed.', run });
    } else run().catch((e) => setError(explain(e)));
  }

  async function postComment() {
    if (!comment.trim()) return;
    try { await api(`/reviews/${review.id}/comments`, { token, method: 'POST', body: JSON.stringify({ body: comment.trim() }) }); setComment(''); await refreshReview(review.id); }
    catch (e) { setError(explain(e, 'Could not post that comment.')); }
  }

  const last = review?.revisions?.[review.revisions.length - 1];
  const report = last ? (() => {
    const models = [...new Set((last.result.agents ?? []).map((a) => a.model).filter(Boolean))];
    return `Reviewed by Verity AI · ${models.length ? models.join(', ') : 'rules engine (basic mode)'} · BIG v${review.big_version} · score ${last.score}/100`;
  })() : null;
  const exportable = review && ['approved', 'published'].includes(review.status) && last;
  const manual = (review?.decisions ?? []).filter((d) => d.decision === 'manual');

  if (!ready) return null;
  if (!token) return <main className="doc"><p>Please <a href="/">choose a demo role</a> first.</p></main>;

  const open = flags.filter((f) => f.state === 'open');
  const resolved = flags.filter((f) => f.state !== 'open');
  const prev = review?.revisions?.length > 1 ? review.revisions[review.revisions.length - 2] : null;
  const shownAgents = live ?? Object.fromEntries((result?.agents ?? []).map((a) => [a.agent, a]));
  const showAgents = busy || !!result;

  return (
    <div className="layout">
      <section>
        <p className="muted" style={{ margin: 0 }}><a href="/queue">← {role === 'creator' ? 'My reviews' : 'Queue'}</a></p>
        <h1 style={{ margin: '4px 0 12px' }}>
          {review ? review.title : 'New review'}{' '}
          {review && <span className="badge">{STATUS_LABEL[review.status] ?? review.status}</span>}
        </h1>
        {review?.creator_name && <p className="muted" style={{ marginTop: -6 }}>By {review.creator_name} · {review.content_type} · checked against BIG v{review.big_version}</p>}
        {!review && !idParam && <input aria-label="Title" placeholder="Title (for example: Spring campaign post)" value={title} onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />}
        {idParam && !review && !error && <><div className="skeleton" /><div className="skeleton" style={{ width: '70%' }} /></>}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {!locked && role !== 'approver' && samples[0] && <button onClick={() => loadSample(samples[0])} disabled={busy}>Load sample content</button>}
          {!locked && role !== 'approver' && samples[1] && <button onClick={() => loadSample(samples[1])} disabled={busy} title="Content that tries to instruct the AI. It should be flagged, not obeyed.">Load prompt-injection test</button>}
          {!locked && role !== 'approver' && <button className="primary" onClick={run} disabled={busy || !editor}>{busy ? 'Reviewing…' : revNumber ? 'Re-run review' : 'Run Verity review'}</button>}
          {review?.actions?.map((a) => {
            const blocked = a.action === 'submit' && !revNumber;
            return (
              <button key={a.action} className={['approve', 'final_approve', 'submit'].includes(a.action) ? 'primary' : ''} disabled={blocked}
                title={blocked ? 'Run a review first, so the approver has something to check.' : ''} onClick={() => act(a.action, a.reason)}>
                {ACTION_LABEL[a.action] ?? a.action}
              </button>);
          })}
          {review && staff && <button onClick={manualFlag} title="Select text in the editor, then click to flag something the AI missed.">Flag selected text</button>}
        </div>

        <div className="card"><EditorContent editor={editor} /></div>
        {locked && <p className="muted">The text is locked while the review is in approval. {staff ? 'You can still override flags and add manual flags.' : ''}</p>}
        {error && <div className="toast" role="alert"><span>{error}</span>{!locked && editor && <button onClick={run} disabled={busy}>Retry</button>}</div>}
        <p className="muted">{report ?? 'Reviewed by Verity AI after you run a review.'} · AI assists, humans decide. Nothing is published automatically.</p>

        {exportable && (
          <div className="card">
            <b>Export approved content</b>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button onClick={() => navigator.clipboard?.writeText(last.text)}>Copy text</button>
              <button onClick={() => download(`${review.title}.md`, `# ${review.title}\n\n${last.text}\n\n---\n*${report}*\n`, 'text/markdown')}>Download .md</button>
              <button onClick={() => download(`${review.title}.json`, JSON.stringify({ title: review.title, status: review.status, big_version: review.big_version, report, text: last.text, score: last.score,
                decisions: review.decisions.map(({ flag_key, rule_id, agent, quoted_text, decision, reason, actor_name }) => ({ flag_key, rule_id, agent, quoted_text, decision, reason, actor_name })) }, null, 2), 'application/json')}>Download JSON</button>
            </div>
          </div>)}

        {review?.revisions?.length >= 2 && (
          <details className="card" open>
            <summary><b>Compare revisions</b></summary>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
              <label>From <select value={diff.from ?? ''} onChange={(e) => setDiff({ ...diff, from: Number(e.target.value), data: null })}>{review.revisions.map((r) => <option key={r.number}>{r.number}</option>)}</select></label>
              <label>to <select value={diff.to ?? ''} onChange={(e) => setDiff({ ...diff, to: Number(e.target.value), data: null })}>{review.revisions.map((r) => <option key={r.number}>{r.number}</option>)}</select></label>
            </div>
            {diff.data ? (
              <>
                <p className="muted" title={TIPS.delta}>Open flags {diff.data.delta.flags_before} → {diff.data.delta.flags_after} · score {diff.data.delta.score_before} → {diff.data.delta.score_after}</p>
                <p style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                  {diff.data.diff.map((d, i) => d.type === 'add' ? <ins key={i} className="diff-add">{d.text}</ins> : d.type === 'del' ? <del key={i} className="diff-del">{d.text}</del> : <span key={i}>{d.text}</span>)}
                </p>
              </>) : <p className="muted">{diff.from === diff.to ? 'Pick two different revisions.' : 'Loading…'}</p>}
          </details>)}

        {review && (
          <details className="card" open={(review.decisions?.length ?? 0) > 0}>
            <summary><b>Decisions and reasons ({review.decisions?.length ?? 0})</b></summary>
            {review.decisions.length === 0 ? <p className="muted">No flag decisions yet.</p> : (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {[...review.decisions].reverse().map((d) => (
                  <li key={d.id} style={{ margin: '4px 0' }}>
                    <b>{d.actor_name}</b> {d.decision} {d.quoted_text ? <>“{d.quoted_text}”</> : 'a flag'} <span className="muted">(rev {d.revision_number}{d.rule_id ? `, ${d.rule_id}` : ''})</span>
                    {d.reason && <span className="muted"> — {d.reason}</span>}
                  </li>))}
              </ul>)}
          </details>)}

        {review && (
          <div className="card">
            <b>Activity</b>
            {review.comments.length === 0 && <p className="muted">No comments yet.</p>}
            {review.comments.map((c) => <p key={c.id} className="muted" style={{ margin: '6px 0' }}><b>{c.author_name}</b> ({c.author_role}): {c.body}</p>)}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input aria-label="Add a comment" placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && postComment()} style={{ flex: 1 }} />
              <button onClick={postComment} disabled={!comment.trim()}>Comment</button>
            </div>
            {review && staff && <p className="muted" style={{ marginBottom: 0 }}><a href={`/audit?review_id=${review.id}`}>View the audit trail for this review →</a></p>}
          </div>)}
      </section>

      <aside>
        <div className="card">
          <b>Review summary</b>
          {!showAgents ? <p className="muted">No review yet. Load a sample and run a review to see flags on the text.</p> : (
            <>
              {result && !busy && (
                <>
                  <p style={{ margin: '8px 0' }}>Revision {revNumber} · <span title={TIPS.score}>score <b>{result.score}/100</b></span> · {open.length} open flag(s)</p>
                  <div className="bar" role="img" aria-label={`Score ${result.score} out of 100`}><i style={{ width: `${result.score}%` }} /></div>
                  {prev && revNumber > 1 && <p className="muted" title={TIPS.delta}>Since revision {prev.number}: {flagCount(prev.result)} → {flagCount(result)} flags, score {prev.score} → {result.score}</p>}
                  <p className="muted">{result.summary}</p>
                  {result.cached && <p className="muted"><span className="badge">cached result</span> Identical content was reviewed before, so this was instant.</p>}
                  {result.cached_demo && <p className="muted"><span className="badge amber">cached demo result</span> The review service was unreachable, so this is the precomputed result for the sample content.</p>}
                </>)}
              <div aria-live="polite" style={{ marginTop: 8 }}>
                {AGENTS.map(([k, label]) => {
                  const a = shownAgents[k];
                  if (!a) return <span key={k} className="chip run">⏳ {label} working…</span>;
                  if (a.status !== 'ok') return <span key={k} className="chip bad" title={a.error || ''}>✕ {label} unavailable {!busy && !locked && <button onClick={run} style={{ padding: '0 6px', fontSize: 12 }}>retry</button>}</span>;
                  return <span key={k} className="chip ok">✓ {label} · {a.findings.length}{a.mode === 'fallback' ? ' (basic mode)' : ''}</span>;
                })}
                <span className="chip" title="Logo and image checks are planned for Round 3">◌ VisualGuard · Round 3</span>
              </div>
              {result && !busy && (
                <details style={{ marginTop: 6 }}>
                  <summary className="muted">Agent run details</summary>
                  <table style={{ width: '100%', fontSize: 12 }}>
                    <thead><tr><th>Agent</th><th>Mode</th><th>Time</th><th>Retries</th><th>Dropped</th><th>Tokens</th></tr></thead>
                    <tbody>{result.agents.map((a) => (
                      <tr key={a.agent}><td>{a.agent}</td><td>{a.model ?? a.mode}</td><td>{a.latency_ms} ms</td><td>{a.retries}</td><td>{a.dropped}</td><td>{a.tokens ? `${a.tokens.input}/${a.tokens.output}` : '–'}</td></tr>))}</tbody>
                  </table>
                  {result.timing && <p className="muted">First agent result in {result.timing.first_agent_ms} ms; full review in {result.timing.total_ms} ms{result.cached ? ' (original run)' : ''}.</p>}
                  <p className="muted" style={{ marginTop: 0 }}>Dropped = findings whose quoted text could not be found in the content, removed to keep highlights accurate.</p>
                </details>)}
            </>)}
        </div>

        <div className="card">
          <b>Flags</b>
          {result && open.length === 0 && <p className="muted">All flags resolved.</p>}
          {resolved.length > 0 && <p className="muted">{resolved.map((f) => `“${f.finding.quoted_text}” ${f.state}`).join(' · ')}</p>}
          {open.map((f) => (
            <div key={f.id} className={`item ${f.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(f.id)}>
              <span className="badge">{f.finding.agent}</span><span className="badge" title={TIPS.severity}>{f.severity}</span>
              <span className="badge" title={TIPS.confidence}>{Math.round(f.finding.confidence * 100)}% conf</span>
              {f.finding.kind === 'suggestion' && <span className="badge amber" title={TIPS.confidence}>suggestion</span>}
              <div style={{ marginTop: 6 }}>“{f.finding.quoted_text}”</div>
              {f.id === activeId && (
                <div style={{ marginTop: 6 }}>
                  <div className="bar" title={TIPS.confidence} style={{ margin: '4px 0' }}><i style={{ width: `${Math.round(f.finding.confidence * 100)}%` }} /></div>
                  <div className="muted">{f.finding.clause_citation}</div>
                  <p style={{ margin: '6px 0' }}>{f.finding.explanation}</p>
                  {f.finding.suggestion && <p style={{ margin: '6px 0' }}><b>Suggestion:</b> {f.finding.suggestion}</p>}
                  {f.finding.source_ref && <p className="muted">Source: {f.finding.source_ref}</p>}
                  {(!locked || staff) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {!locked && <button className="primary" disabled={!f.finding.replacement} title={f.finding.replacement ? 'Replace the flagged text with the suggested wording' : 'No automatic fix. Use Edit to rewrite it yourself.'} onClick={(e) => { e.stopPropagation(); accept(f); }}>Accept fix</button>}
                      {!locked && <button onClick={(e) => { e.stopPropagation(); edit(f); }} title="Select this text in the editor so you can rewrite it">Edit</button>}
                      <button onClick={(e) => { e.stopPropagation(); dispute(f); }}>{staff ? 'Override' : 'Dispute'}</button>
                    </div>)}
                </div>)}
            </div>))}
        </div>

        {manual.length > 0 && (
          <div className="card">
            <b>Manual flags</b>
            {manual.map((d) => <p key={d.id} className="muted" style={{ margin: '6px 0' }}><b>{d.actor_name}</b> flagged “{d.quoted_text}” — {d.reason}</p>)}
          </div>)}
      </aside>

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
export default function ReviewPage() {
  return <Suspense fallback={null}><ReviewInner /></Suspense>;
}
