import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { brandContext } from '../brand.js';
import { audit } from '../audit.js';
import { buildReport } from '../report.js';
import { rateLimiter } from '../limits.js';

const sha = (token) => crypto.createHash('sha256').update(token).digest('hex');
const MAX_DAYS = 90;

// Read-only report links for clients. Managers create and revoke them; anyone holding a live link can read the report,
// which is why the token is long and random, only its hash is stored, and links expire.
export function shareRouter({ db }) {
  const r = Router();
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'server_error' }); });
  const owner = [requireAuth, brandContext(db), requireRole('manager', 'admin')];
  const publicLimit = rateLimiter(60, 60000);

  r.post('/share-links', owner, wrap(async (req, res) => {
    const days = req.body?.days === undefined ? 14 : Number(req.body.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS)
      return res.status(400).json({ error: 'invalid_days', detail: `days must be a whole number from 1 to ${MAX_DAYS}` });
    if (req.body?.label !== undefined && (typeof req.body.label !== 'string' || req.body.label.length > 100))
      return res.status(400).json({ error: 'invalid_label', detail: 'label must be text of at most 100 characters' });
    const token = crypto.randomBytes(24).toString('base64url');
    const [row] = await db.query(
      `INSERT INTO share_links (brand_id, token_hash, label, created_by, expires_at)
       VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval) RETURNING id, label, created_at, expires_at`,
      [req.brand, sha(token), req.body?.label?.trim() || null, req.user.sub, String(days)]);
    await audit(db, { brandId: req.brand, actor: req.user, action: 'share.created', detail: { link_id: row.id, days } });
    res.status(201).json({ ...row, token, path: `/report?token=${token}` });   // the only time the token is shown
  }));

  r.get('/share-links', owner, wrap(async (req, res) => {
    res.json(await db.query(
      `SELECT id, label, created_at, expires_at, revoked_at,
              (revoked_at IS NULL AND expires_at > now()) AS active
       FROM share_links WHERE brand_id=$1 ORDER BY id DESC`, [req.brand]));
  }));

  r.delete('/share-links/:id', owner, wrap(async (req, res) => {
    const [row] = await db.query(
      'UPDATE share_links SET revoked_at = now() WHERE id=$1 AND brand_id=$2 AND revoked_at IS NULL RETURNING id',
      [Number(req.params.id) || 0, req.brand]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    await audit(db, { brandId: req.brand, actor: req.user, action: 'share.revoked', detail: { link_id: row.id } });
    res.json({ ok: true });
  }));

  // No sign-in: the token is the credential. A wrong, expired or revoked token all give the same answer.
  r.get('/public/report/:token', wrap(async (req, res) => {
    const lim = publicLimit(req.ip);
    if (!lim.ok) return res.set('retry-after', String(lim.retryAfter)).status(429).json({ error: 'rate_limited', retry_after: lim.retryAfter });
    const [link] = await db.query(
      'SELECT brand_id FROM share_links WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()', [sha(String(req.params.token))]);
    if (!link) return res.status(404).json({ error: 'not_found' });
    res.set('cache-control', 'no-store').json(await buildReport(db, link.brand_id));
  }));

  return r;
}
