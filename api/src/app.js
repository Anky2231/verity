import express from 'express';
import cors from 'cors';
import { DEMO_USERS } from './users.js';
import { reviewsRouter } from './routes/reviews.js';
import { governanceRouter } from './routes/governance.js';
import { brandRouter } from './routes/brand.js';
import { notificationsRouter } from './routes/notifications.js';
import { signToken, requireAuth, requireRole } from './auth.js';
import { createReviewQueue } from './queue.js';
import { securityHeaders, requestLog } from './http.js';

export function createApp({ db, log } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(requestLog(log));
  app.use(cors({ origin: process.env.WEB_ORIGIN || true, exposedHeaders: ['X-Request-Id', 'Retry-After'] }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) =>
    res.json({ ok: true, service: 'verity-api', time: new Date().toISOString() }));

  // Aggregated health: lets the web app show whether the AI service is up.
  app.get('/health/deep', async (_req, res) => {
    const url = process.env.AI_SERVICE_URL;
    let ai = 'unconfigured';
    if (url) {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
        ai = r.ok ? 'up' : 'down';
      } catch { ai = 'down'; }
    }
    res.json({ ok: true, api: 'up', ai });
  });

  app.get('/auth/demo-users', (_req, res) => res.json(DEMO_USERS));

  // One-click demo login: no passwords for judges.
  app.post('/auth/demo-login', (req, res) => {
    const user = DEMO_USERS.find((u) => u.role === req.body?.role || u.id === req.body?.userId);
    if (!user) return res.status(400).json({ error: 'unknown_demo_role' });
    res.json({ token: signToken(user), user });
  });

  app.get('/me', requireAuth, (req, res) => res.json(req.user));

  const aiFetch = async (path, init = {}) => {
    const r = await fetch(`${process.env.AI_SERVICE_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-service-token': process.env.AI_SERVICE_TOKEN || '' },
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`ai ${r.status}`);
    return r.json();
  };

  // Streaming variant: returns the raw response so the caller can read NDJSON as agents finish.
  const aiStream = async (path, body) => {
    const r = await fetch(`${process.env.AI_SERVICE_URL}${path}`, {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-service-token': process.env.AI_SERVICE_TOKEN || '' },
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) throw new Error(`ai ${r.status}`);
    return r;
  };

  app.get('/sample', requireAuth, async (_req, res) => {
    try { res.json(await aiFetch('/sample')); }
    catch { res.status(502).json({ error: 'ai_unavailable' }); }
  });

  if (db) {
    const reviewQueue = process.env.REDIS_URL ? createReviewQueue({ aiFetch }) : null;
    app.locals.closeQueue = () => reviewQueue?.close();
    app.use('/reviews', reviewsRouter({ db, aiFetch, aiStream, reviewQueue }));
    app.use('/brand', brandRouter({ db, aiFetch }));
    app.use('/notifications', notificationsRouter({ db }));
    app.use('/', governanceRouter({ db }));
  }

  return app;
}
