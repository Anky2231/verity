import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { brandContext } from '../brand.js';
import { audit } from '../audit.js';
import { MAX_LOGO_BYTES, MAX_PALETTE, readImageUpload, validateAssetMeta } from '../validate.js';

// Approved logos, retired logos and palette colours for the active brand: what VisualGuard checks images against.
export function assetsRouter({ db }) {
  const r = Router();
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'server_error' }); });
  const staff = [requireAuth, brandContext(db), requireRole('manager', 'approver', 'admin')];
  const editor = [requireAuth, brandContext(db), requireRole('manager', 'admin')];

  r.get('/brand-assets', staff, wrap(async (req, res) => {
    res.json(await db.query(
      `SELECT id, kind, filename, name, hex, mime, octet_length(data)::int AS size, created_at
         FROM brand_assets WHERE brand_id=$1 ORDER BY kind, id`, [req.brand]));
  }));

  r.post('/brand-assets', editor, wrap(async (req, res) => {
    const b = req.body ?? {};
    const invalid = validateAssetMeta(b); if (invalid) return res.status(400).json(invalid);
    let row;
    if (b.kind === 'palette') {
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM brand_assets WHERE brand_id=$1 AND kind='palette'`, [req.brand]);
      if (n >= MAX_PALETTE) return res.status(409).json({ error: 'palette_full', detail: `a palette can hold at most ${MAX_PALETTE} colours` });
      [row] = await db.query(
        `INSERT INTO brand_assets (brand_id, kind, filename, mime, name, hex, created_by) VALUES ($1,'palette',$2,'text/plain',$2,lower($3),$4)
         RETURNING id, kind, name, hex, created_at`, [req.brand, b.name.trim(), b.hex, req.user.sub]);
    } else {
      const up = readImageUpload(b, MAX_LOGO_BYTES);
      if (up.error) return res.status(up.status ?? 400).json(up.error);
      [row] = await db.query(
        `INSERT INTO brand_assets (brand_id, kind, filename, mime, data, name, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, kind, filename, name, mime, created_at`, [req.brand, b.kind, b.filename.trim(), up.mime, up.bytes, (b.name ?? b.filename).trim().slice(0, 60), req.user.sub]);
    }
    await audit(db, { brandId: req.brand, actor: req.user, action: 'asset.added', detail: { asset_id: row.id, kind: row.kind, name: row.name ?? row.filename } });
    res.status(201).json(row);
  }));

  // Image bytes for previews. The page fetches this with its token and shows it as a blob, because <img> cannot send headers.
  r.get('/brand-assets/:id/image', staff, wrap(async (req, res) => {
    const [row] = await db.query(`SELECT mime, data FROM brand_assets WHERE id=$1 AND brand_id=$2 AND data IS NOT NULL`, [Number(req.params.id) || 0, req.brand]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.set({ 'content-type': row.mime, 'cache-control': 'private, max-age=300' }).send(row.data);
  }));

  r.delete('/brand-assets/:id', editor, wrap(async (req, res) => {
    const [row] = await db.query('DELETE FROM brand_assets WHERE id=$1 AND brand_id=$2 RETURNING id, kind, name, filename', [Number(req.params.id) || 0, req.brand]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    await audit(db, { brandId: req.brand, actor: req.user, action: 'asset.removed', detail: { asset_id: row.id, kind: row.kind, name: row.name ?? row.filename } });
    res.json({ ok: true });
  }));

  return r;
}
