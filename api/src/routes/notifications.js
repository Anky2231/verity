import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { brandContext } from '../brand.js';

export function notificationsRouter({ db }) {
  const r = Router();
  r.use(requireAuth, brandContext(db));
  r.get('/', async (req, res) => {
    const items = await db.query('SELECT id, review_id, message, read, email_status, created_at FROM notifications WHERE user_id=$1 AND brand_id=$2 ORDER BY id DESC LIMIT 30', [req.user.sub, req.brand]);
    const [{ n }] = await db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND brand_id=$2 AND NOT read', [req.user.sub, req.brand]);
    res.json({ unread: n, items });
  });
  r.post('/read', async (req, res) => {
    await db.query('UPDATE notifications SET read=true WHERE user_id=$1 AND brand_id=$2', [req.user.sub, req.brand]);
    res.json({ ok: true });
  });
  return r;
}
