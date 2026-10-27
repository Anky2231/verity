import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { brandContext } from '../brand.js';
import { audit } from '../audit.js';
import { validateBig, bigCounts } from '../big.js';
import fs from 'node:fs';

const MAX_FILE_B64 = 7_000_000; // ~5 MB file

export function brandRouter({ db, aiFetch }) {
  const r = Router();
  r.use(requireAuth, brandContext(db));
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'server_error' }); });
  const staff = requireRole('manager', 'approver', 'admin');
  const editor = requireRole('manager', 'admin');

  r.get('/', staff, wrap(async (req, res) => {
    const versions = await db.query(
      `SELECT v.version, v.published_at AS created_at, u.name AS created_by, data FROM big_versions v LEFT JOIN users u ON u.id=v.created_by
       WHERE v.brand_id=$1 ORDER BY v.version DESC`, [req.brand]);
    const [b] = await db.query('SELECT id, name FROM brands WHERE id=$1', [req.brand]);
    res.json({ brand: b, current: versions[0]?.data ?? null,
      versions: versions.map((v) => ({ version: v.version, created_at: v.created_at, created_by: v.created_by, ...bigCounts(v.data) })) });
  }));

  r.get('/versions/:v', staff, wrap(async (req, res) => {
    const [v] = await db.query('SELECT data FROM big_versions WHERE brand_id=$1 AND version=$2', [req.brand, Number(req.params.v)]);
    if (!v) return res.status(404).json({ error: 'not_found' });
    res.json(v.data);
  }));

  // Guideline file (or the built-in sample) -> structured draft for the preview screen. Nothing is saved yet.
  r.post('/extract', editor, wrap(async (req, res) => {
    let { filename, content_base64, use_sample } = req.body ?? {};
    // "Use sample" means the sample of the active brand. Lumina's lives in the AI service; the others ship a guideline file.
    if (use_sample && req.brand !== 'lumina') {
      try {
        content_base64 = fs.readFileSync(new URL(`../../seed/${req.brand}_guideline.md`, import.meta.url)).toString('base64');
        filename = `${req.brand}-guidelines.md`; use_sample = false;
      } catch { return res.status(400).json({ error: 'no_sample_for_brand', detail: 'this brand has no sample guideline; upload a file instead' }); }
    }
    if (!use_sample && (typeof content_base64 !== 'string' || !content_base64)) return res.status(400).json({ error: 'file_required' });
    if (typeof content_base64 === 'string' && content_base64.length > MAX_FILE_B64) return res.status(413).json({ error: 'file_too_large' });
    try {
      const out = await aiFetch('/extract', { method: 'POST', body: JSON.stringify({ filename: String(filename ?? 'guidelines.txt'), content_base64, use_sample: !!use_sample, brand_id: req.brand }) });
      await audit(db, { brandId: req.brand, actor: req.user, action: 'big.extracted', detail: { filename: use_sample ? 'sample' : filename, ...bigCounts(out.big), notes: out.notes.length } });
      res.json(out);
    } catch (e) {
      const m = /ai (\d+)/.exec(e.message);
      res.status(m && m[1] === '422' ? 422 : m && m[1] === '413' ? 413 : 502)
        .json({ error: m && m[1] === '422' ? 'unreadable_file' : 'ai_unavailable', detail: e.detail });
    }
  }));

  // Publishing creates BIG version N+1. Old versions stay; running reviews keep the version they started with.
  r.post('/publish', editor, wrap(async (req, res) => {
    const [{ v }] = await db.query('SELECT coalesce(max(version),0) AS v FROM big_versions WHERE brand_id=$1', [req.brand]);
    const out = validateBig(req.body?.big, { brandId: req.brand, version: v + 1 });
    if (!out.ok) return res.status(400).json({ error: 'invalid_big', errors: out.errors });
    try {
      await db.query('INSERT INTO big_versions (brand_id, version, data, created_by) VALUES ($1,$2,$3::jsonb,$4)', [req.brand, v + 1, JSON.stringify(out.big), req.user.sub]);
    } catch { return res.status(409).json({ error: 'version_conflict' }); }
    await audit(db, { brandId: req.brand, actor: req.user, action: 'big.published', detail: { version: v + 1, ...bigCounts(out.big) } });
    res.status(201).json({ version: v + 1, ...bigCounts(out.big) });
  }));
  return r;
}
