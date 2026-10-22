import test from 'node:test';
import assert from 'node:assert/strict';

// Redis is configured but nothing is listening: reviews must still complete, quickly, via the direct pipeline.
process.env.REDIS_URL = 'redis://127.0.0.1:6999';
process.env.QUEUE_READY_TIMEOUT_MS = '1500';
process.env.AI_SERVICE_URL = 'http://ai.test';

const { createReviewQueue } = await import('../src/queue.js');
const { createApp } = await import('../src/app.js');
const { freshDb } = await import('./helpers.js');
const { seed } = await import('../src/seed.js');

const realFetch = globalThis.fetch;
const agent = (n) => ({ agent: n, status: 'ok', mode: 'rules', findings: [], latency_ms: 1, retries: 0 });
const result = (text) => ({ text, score: 90, agents: ['claim', 'term', 'tone'].map(agent), timing: { first_agent_ms: 1, total_ms: 2 }, highlights: [] });

test('an unreachable Redis makes queue.run reject with queue_unavailable instead of hanging', async () => {
  const queue = createReviewQueue({ aiFetch: async () => ({}), name: 'fallback-direct', readyTimeoutMs: 500 });
  const t0 = Date.now();
  try {
    await assert.rejects(queue.run({ text: 'hello', calibration: {} }), /queue_unavailable/);
    assert.ok(Date.now() - t0 < 3000, 'must give up quickly');
  } finally { await queue.close(); }
});

test('reviews still complete when REDIS_URL is unreachable, and later requests skip the broken queue', async () => {
  const db = await freshDb(); await seed(db);
  let aiCalls = 0;
  globalThis.fetch = (url, init) => {
    const u = String(url);
    if (!u.startsWith('http://ai.test')) return realFetch(url, init);
    aiCalls++;
    const body = JSON.parse(init.body);
    if (u.endsWith('/stream/review')) {
      const lines = [...['claim', 'term', 'tone'].map((n) => JSON.stringify({ event: 'agent', result: agent(n) })), JSON.stringify({ event: 'done', result: result(body.text) })];
      return Promise.resolve(new Response(lines.join('\n') + '\n', { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(result(body.text)), { status: 200 }));
  };
  const app = createApp({ db });
  const server = app.listen(0); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const token = (await (await realFetch(`${base}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'creator' }) })).json()).token;
    const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
    const review = await (await realFetch(`${base}/reviews`, { method: 'POST', headers: h, body: JSON.stringify({ title: 'redis down' }) })).json();
    const run = async (text) => { const t0 = Date.now(); const r = await realFetch(`${base}/reviews/${review.id}/run`, { method: 'POST', headers: h, body: JSON.stringify({ text }) }); return { status: r.status, body: await r.json(), ms: Date.now() - t0 }; };

    const first = await run('first request while Redis is down');
    assert.equal(first.status, 200); assert.equal(first.body.score, 90);
    assert.ok(first.ms >= 1000, `the first request waits for the queue deadline (${first.ms} ms)`);

    const second = await run('second request, different text');
    assert.equal(second.status, 200);
    assert.ok(second.ms < 800, `the circuit breaker skips the queue (${second.ms} ms)`);
    assert.equal(aiCalls, 2, 'both reviews were served by the direct AI path');
  } finally {
    globalThis.fetch = realFetch; server.close(); server.closeAllConnections?.();
    await app.locals.closeQueue(); await db.close();
  }
});
