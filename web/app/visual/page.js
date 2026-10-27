'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, explain, fetchBlobUrl } from '../../lib/api';
import { useSession } from '../../lib/session';
import { usePageTitle } from '../../lib/title';
import { ACTION_LABEL, STATUS_LABEL, TIPS } from '../../lib/labels';
import ReasonDialog from '../../components/ReasonDialog';

const readBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(new Error('read failed'));
  r.readAsDataURL(file);
});
const SEV_COLOUR = { low: '#0e7490', medium: '#b45309', high: '#b91c1c', critical: '#7f1d1d' };

// One image, checked by VisualGuard: the picture with a numbered box on every problem, and the same list as text.
function VisualInner() {
  const router = useRouter();
  const idParam = useSearchParams().get('id');
  const { token, role, ready, brand } = useSession();
  usePageTitle('Image review');
  const [review, setReview] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  const [reasonRequest, setReasonRequest] = useState(null);
  const file = useRef(null);
  const canUpload = ['creator', 'manager', 'admin'].includes(role);

  const load = useCallback(async (id) => {
    const r = await api(`/reviews/${id}`, { token });
    setReview(r);
    return r;
  }, [token]);
  useEffect(() => { if (token && idParam) load(idParam).catch((e) => setError(explain(e, 'Could not load that review.'))); }, [token, idParam, load]);

  const last = review?.revisions?.at(-1);
  const revNumber = last?.number;
  useEffect(() => {
    if (!review || !revNumber) { setImageUrl(null); return undefined; }
    let live = true, made = null;
    fetchBlobUrl(`/reviews/${review.id}/image/${revNumber}`, token).then((u) => { made = u; live ? setImageUrl(u) : URL.revokeObjectURL(u); }).catch(() => setImageUrl(null));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [review?.id, revNumber, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = last?.result;
  const dims = result?.image;
  const items = (result?.highlights ?? []).flatMap((h, hi) => h.findings.map((f, fi) => ({ key: `v${revNumber}-${hi}-${fi}`, n: 0, f })));
  items.forEach((x, i) => { x.n = i + 1; });
  const decisionOf = (key) => review?.decisions?.filter((d) => d.flag_key === key && d.revision_number === revNumber).at(-1);

  async function upload(f, reviewId) {
    const body = { filename: f.name, content_base64: await readBase64(f) };
    return api(`/reviews/${reviewId}/image`, { token, method: 'POST', body: JSON.stringify(body) });
  }
  async function start(e) {
    e.preventDefault();
    const f = file.current?.files?.[0];
    if (!f) { setError('Choose an image first.'); return; }
    setBusy(true); setError('');
    try {
      const made = await api('/reviews', { token, method: 'POST', body: JSON.stringify({ title: title.trim() || f.name, content_type: 'image' }) });
      await upload(f, made.id);
      router.replace(`/visual?id=${made.id}`);
    } catch (err) { setError(explain(err, 'Could not check that image.')); } finally { setBusy(false); }
  }
  async function replace(e) {
    const f = e.target.files?.[0]; if (!f || !review) return;
    setBusy(true); setError('');
    try { await upload(f, review.id); await load(review.id); setActive(null); }
    catch (err) { setError(explain(err, 'Could not check that image.')); } finally { setBusy(false); e.target.value = ''; }
  }

  function askReason({ title: t, description, failure, run }) {
    setReasonRequest({ title: t, description, onConfirm: async (reason) => {
      try { await run(reason); } catch (err) { setError(explain(err, failure)); } finally { setReasonRequest(null); }
    } });
  }
  async function decide(x, decision, reason) {
    await api(`/reviews/${review.id}/decisions`, { token, method: 'POST', body: JSON.stringify({
      revision: revNumber, flag_key: x.key, rule_id: x.f.rule_id, agent: 'visual', quoted_text: x.f.quoted_text, decision, reason }) });
    await load(review.id);
  }
  const staff = ['manager', 'approver', 'admin'].includes(role);
  function dispute(x) {
    askReason({ title: staff ? 'Override flag' : 'Dispute flag', description: staff ? 'Explain why you are overriding this flag.' : 'Explain why you disagree with this flag.',
      failure: 'Could not save that decision.', run: (reason) => decide(x, staff ? 'overridden' : 'disputed', reason) });
  }
  function act(action, needsReason) {
    const run = async (reason) => { await api(`/reviews/${review.id}/transition`, { token, method: 'POST', body: JSON.stringify({ action, reason }) }); setError(''); await load(review.id); };
    if (needsReason) askReason({ title: 'Reason required', description: `Explain why you want to ${(ACTION_LABEL[action] ?? action).toLowerCase()}.`, failure: 'That action failed.', run });
    else run().catch((err) => setError(explain(err)));
  }

  if (!ready) return null;
  if (!token) return <div className="doc"><p>Please <a href="/">choose a demo role</a> first.</p></div>;
  const locked = review && !['draft', 'changes_requested'].includes(review.status);

  // ---- New image review ----
  if (!idParam) {
    return (
      <div className="doc">
        <h1 style={{ marginBottom: 4 }}>New image review</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Upload a banner, ad or social graphic. VisualGuard checks it against {brand?.name ?? 'the brand'}’s logos and colour palette and marks every problem on the image.
        </p>
        {!canUpload ? <p>Approvers review images that others have uploaded. <a href="/queue">Open the queue</a></p> : (
          <form onSubmit={start} className="card" style={{ display: 'grid', gap: 10 }}>
            <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="For example: Spring banner" style={{ width: '100%', boxSizing: 'border-box', padding: 8 }} /></label>
            <label>Image <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>
            <p className="muted" style={{ margin: 0 }}>PNG, JPEG, WebP or GIF, up to 6 MB. Large images are checked at up to 1600 px.</p>
            <div><button className="primary" type="submit" disabled={busy}>{busy ? 'Checking the image…' : 'Check image'}</button></div>
            {error && <p role="alert" style={{ color: 'var(--red)', margin: 0 }}>{error}</p>}
          </form>)}
      </div>);
  }

  return (
    <div className="doc">
      <p className="muted" style={{ margin: 0 }}><a href="/queue">← Queue</a></p>
      <h1 style={{ margin: '4px 0' }}>{review?.title ?? 'Image review'}</h1>
      {review && <p className="muted" style={{ marginTop: 0 }}>
        <span className="badge">{STATUS_LABEL[review.status] ?? review.status}</span> By {review.creator_name} · image review · revision {revNumber ?? '—'}
        {result && <> · <span title={TIPS.score}>score <b>{result.score}/100</b></span></>}</p>}
      {error && <div className="toast" role="alert"><span>{error}</span></div>}
      {!review && !error && <div className="skeleton" style={{ height: 240 }} />}

      {review && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {!locked && canUpload && (
            <label className="btn primary" style={{ cursor: 'pointer' }}>
              {busy ? 'Checking…' : revNumber ? 'Upload a new version' : 'Upload an image'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={replace} disabled={busy} className="sr-only" aria-label="Upload an image" />
            </label>)}
          {review.actions?.map((a) => (
            <button key={a.action} className={['approve', 'final_approve', 'submit'].includes(a.action) ? 'primary' : ''} disabled={a.action === 'submit' && !revNumber}
              title={a.action === 'submit' && !revNumber ? 'Upload an image first, so the approver has something to check.' : ''} onClick={() => act(a.action, a.reason)}>
              {ACTION_LABEL[a.action] ?? a.action}
            </button>))}
        </div>)}

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, alignItems: 'start' }}>
          <section aria-label="The image with problems marked">
            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 }}>
              {imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={imageUrl} alt={`Uploaded image: ${last.text.replace('[image] ', '')}`} style={{ maxWidth: '100%', height: 'auto', display: 'block', border: '1px solid var(--line)' }} />
                : <div className="skeleton" style={{ width: 360, height: 220 }} />}
              {imageUrl && dims && items.map((x) => {
                const r = x.f.region; if (!r) return null;
                const on = active === x.key;
                return (
                  <button key={x.key} onClick={() => setActive(x.key)} aria-label={`Problem ${x.n}: ${x.f.clause_citation}`} aria-pressed={on}
                    style={{ position: 'absolute', left: `${(r.x / dims.width) * 100}%`, top: `${(r.y / dims.height) * 100}%`, width: `${(r.w / dims.width) * 100}%`, height: `${(r.h / dims.height) * 100}%`,
                      border: `${on ? 3 : 2}px solid ${SEV_COLOUR[x.f.severity] ?? '#b91c1c'}`, background: on ? 'rgba(255,255,255,.18)' : 'transparent', padding: 0, borderRadius: 4, cursor: 'pointer', boxSizing: 'border-box' }}>
                    <span style={{ position: 'absolute', top: -1, left: -1, background: SEV_COLOUR[x.f.severity] ?? '#b91c1c', color: '#fff', fontSize: 12, lineHeight: '16px', minWidth: 18, textAlign: 'center', padding: '0 3px', borderRadius: '3px 0 3px 0' }}>{x.n}</span>
                  </button>);
              })}
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>VisualGuard · image analysis · {result.timing?.total_ms ?? 0} ms. Boxes are numbered like the list.</p>
          </section>

          <section aria-label="Problems found">
            {items.length === 0 && <div className="card"><b>No problems found.</b><p className="muted" style={{ marginBottom: 0 }}>The colours are in the palette and no logo problem was detected.</p></div>}
            {items.map((x) => {
              const d = decisionOf(x.key);
              return (
                <div key={x.key} className={`card item${active === x.key ? ' flag-active' : ''}`} style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button onClick={() => setActive(x.key)} aria-pressed={active === x.key} style={{ padding: '2px 8px' }}>Problem {x.n}</button>
                    <span className="badge">visual</span><span className="badge" title={TIPS.severity}>{x.f.severity}</span>
                    <span className="badge" title={TIPS.confidence}>{Math.round(x.f.confidence * 100)}% confident</span>
                    {x.f.kind === 'suggestion' && <span className="badge amber">suggestion</span>}
                    {d && <span className={`badge ${d.decision === 'accepted' ? 'green' : 'amber'}`}>{d.decision}</span>}
                  </div>
                  <p style={{ margin: '6px 0 2px' }}><b>{x.f.clause_citation}</b></p>
                  <p style={{ margin: '2px 0' }}>{x.f.explanation}</p>
                  {x.f.suggestion && <p className="muted" style={{ margin: '2px 0' }}>Suggested fix: {x.f.suggestion}</p>}
                  {!locked && !d && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      {!staff && <button onClick={() => decide(x, 'accepted').catch((err) => setError(explain(err, 'Could not save that decision.')))}>I will fix this</button>}
                      <button onClick={() => dispute(x)}>{staff ? 'Override' : 'Dispute'}</button>
                    </div>)}
                  {d?.reason && <p className="muted" style={{ margin: '6px 0 0' }}>Reason: {d.reason}</p>}
                </div>);
            })}
            {review.comments?.length > 0 && (
              <div className="card"><b>Comments</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{review.comments.map((c) => <li key={c.id}><b>{c.author_name}:</b> {c.body}</li>)}</ul></div>)}
          </section>
        </div>)}

      {review && !result && !error && <div className="card"><p style={{ margin: 0 }}>{canUpload ? 'No image has been checked yet. Use “Upload an image” above.' : 'The creator has not uploaded an image yet.'}</p></div>}
      <ReasonDialog open={!!reasonRequest} title={reasonRequest?.title} description={reasonRequest?.description} onConfirm={reasonRequest?.onConfirm ?? (() => {})} onCancel={() => setReasonRequest(null)} />
    </div>
  );
}

export default function VisualPage() { return <Suspense fallback={null}><VisualInner /></Suspense>; }
