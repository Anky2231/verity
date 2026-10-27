'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, explain, fetchBlobUrl } from '../lib/api';

const KIND = { logo: 'Approved logo', retired_logo: 'Retired logo' };
const readBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(new Error('read failed'));
  r.readAsDataURL(file);
});

function Thumb({ id, token, label }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true, made = null;
    fetchBlobUrl(`/brand-assets/${id}/image`, token).then((u) => { made = u; live ? setUrl(u) : URL.revokeObjectURL(u); }).catch(() => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id, token]);
  return url ? <img src={url} alt={label} style={{ width: 56, height: 56, objectFit: 'contain', background: 'var(--line)', borderRadius: 6 }} /> : <div className="skeleton" style={{ width: 56, height: 56 }} />;
}

// The brand's approved logos, retired logos and colour palette: what VisualGuard checks every image against.
export default function BrandAssets({ token, canEdit }) {
  const [assets, setAssets] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [colour, setColour] = useState({ name: '', hex: '#c77d0a' });
  const [logoKind, setLogoKind] = useState('logo');
  const [logoName, setLogoName] = useState('');
  const file = useRef(null);

  const load = useCallback(async () => {
    try { setAssets(await api('/brand-assets', { token })); setError(''); } catch (e) { setError(explain(e, 'Could not load the brand assets.')); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const palette = assets.filter((a) => a.kind === 'palette');
  const logos = assets.filter((a) => a.kind !== 'palette');

  async function add(body) {
    setBusy(true); setError('');
    try { await api('/brand-assets', { token, method: 'POST', body: JSON.stringify(body) }); await load(); return true; }
    catch (e) { setError(explain(e, 'Could not add that.')); return false; } finally { setBusy(false); }
  }
  async function remove(a) {
    setError('');
    try { await api(`/brand-assets/${a.id}`, { token, method: 'DELETE' }); await load(); } catch (e) { setError(explain(e, 'Could not remove that.')); }
  }
  async function addColour(e) {
    e.preventDefault();
    if (!colour.name.trim()) { setError('Give the colour a name.'); return; }
    if (await add({ kind: 'palette', name: colour.name.trim(), hex: colour.hex })) setColour({ name: '', hex: colour.hex });
  }
  async function addLogo(e) {
    e.preventDefault();
    const f = file.current?.files?.[0];
    if (!f) { setError('Choose a logo file first.'); return; }
    if (await add({ kind: logoKind, filename: f.name, name: logoName.trim() || f.name, content_base64: await readBase64(f) })) { file.current.value = ''; setLogoName(''); }
  }

  return (
    <section className="card" aria-labelledby="assets-h">
      <b id="assets-h">Brand assets for VisualGuard</b>
      <p className="muted" style={{ margin: '4px 0 10px' }}>
        Images are checked against these. VisualGuard flags colours that are not in the palette, a retired logo, and an approved logo that is stretched,
        recoloured or crowded. Use PNG logos with a transparent background.
      </p>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      <h3 style={{ margin: '10px 0 6px' }}>Colour palette</h3>
      {palette.length === 0 && <p className="muted">No colours yet, so the palette check is off.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {palette.map((c) => (
          <li key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px' }}>
            <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 4, background: c.hex, border: '1px solid var(--line)' }} />
            <span>{c.name} <span className="muted">{c.hex}</span></span>
            {canEdit && <button onClick={() => remove(c)} aria-label={`Remove colour ${c.name}`} style={{ padding: '0 6px' }}>×</button>}
          </li>))}
      </ul>
      {canEdit && (
        <form onSubmit={addColour} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <label>Name <input value={colour.name} onChange={(e) => setColour({ ...colour, name: e.target.value })} maxLength={60} placeholder="For example: Amber" style={{ padding: 6 }} /></label>
          <label>Colour <input type="color" value={colour.hex} onChange={(e) => setColour({ ...colour, hex: e.target.value })} aria-label="Colour value" style={{ verticalAlign: 'middle' }} /> <code>{colour.hex}</code></label>
          <button type="submit" disabled={busy}>Add colour</button>
        </form>)}

      <h3 style={{ margin: '16px 0 6px' }}>Logos</h3>
      {logos.length === 0 && <p className="muted">No logos yet, so logo checks are off.</p>}
      <div style={{ overflowX: 'auto' }}>
        {logos.length > 0 && (
          <table>
            <thead><tr><th><span className="sr-only">Preview</span></th><th>Name</th><th>Kind</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{logos.map((a) => (
              <tr key={a.id}>
                <td><Thumb id={a.id} token={token} label={`${a.name ?? a.filename} preview`} /></td>
                <td>{a.name ?? a.filename}</td>
                <td><span className={`badge ${a.kind === 'logo' ? 'green' : 'amber'}`}>{KIND[a.kind]}</span></td>
                <td>{canEdit && <button onClick={() => remove(a)} aria-label={`Remove logo ${a.name ?? a.filename}`}>Remove</button>}</td>
              </tr>))}</tbody>
          </table>)}
      </div>
      {canEdit && (
        <form onSubmit={addLogo} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Logo file" />
          <label>Kind <select value={logoKind} onChange={(e) => setLogoKind(e.target.value)}><option value="logo">Approved logo</option><option value="retired_logo">Retired logo</option></select></label>
          <label>Name <input value={logoName} onChange={(e) => setLogoName(e.target.value)} maxLength={60} placeholder="Optional" style={{ padding: 6 }} /></label>
          <button type="submit" disabled={busy}>Add logo</button>
        </form>)}
    </section>
  );
}
