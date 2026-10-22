import { Router } from 'express';
import { requireAuth } from '../auth.js';

export function notificationsRouter({ db }) {
  const r = Router();
  r.use(requireAuth);
  r.get('/', async (req, res) => {
    const items = await db.query('SELECT id, review_id, message, read, email_status, created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [req.user.sub]);
    const [{ n }] = await db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND NOT read', [req.user.sub]);
    res.json({ unread: n, items });
  });
  r.post('/read', async (req, res) => {
    await db.query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.sub]);
    res.json({ ok: true });
  });
  return r;
}
