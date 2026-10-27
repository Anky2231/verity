import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { brandContext } from '../brand.js';
import { driftFor } from '../drift-store.js';

export function driftRouter({ db }) {
  const r = Router();
  const staff = [requireAuth, brandContext(db), requireRole('manager', 'approver', 'admin')];

  // Per-team drift against each team's own baseline, the clauses most likely to be broken next, and this week's digest.
  r.get('/drift', staff, async (req, res) => {
    try {
      const [brand] = await db.query('SELECT name FROM brands WHERE id=$1', [req.brand]);
      res.set('cache-control', 'no-store').json(await driftFor(db, req.brand, brand?.name ?? req.brand));
    } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
  });
  return r;
}
