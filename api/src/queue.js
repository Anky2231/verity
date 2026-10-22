import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';

const AGENTS = ['tone', 'term', 'claim'];
const QUEUE_NAME = 'verity-review-agents';
const READY_TIMEOUT_MS = Number(process.env.QUEUE_READY_TIMEOUT_MS || 3000);

// Redis outages must never hang a review: connecting and enqueuing get a short deadline.
function withTimeout(promise, ms, message) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function redisConnection(redisUrl, isClosing) {
  const url = new URL(redisUrl);
  const connection = {
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379)),
    maxRetriesPerRequest: null,
    // Keep reconnecting with a short backoff, but stop as soon as the queue is being closed.
    retryStrategy: (times) => (isClosing() ? null : Math.min(times * 200, 2000)),
  };
  if (url.username) connection.username = decodeURIComponent(url.username);
  if (url.password) connection.password = decodeURIComponent(url.password);
  if (url.pathname.length > 1) connection.db = Number(url.pathname.slice(1));
  if (url.protocol === 'rediss:') connection.tls = {};
  return connection;
}

export function createReviewQueue({ aiFetch, redisUrl = process.env.REDIS_URL, name = QUEUE_NAME, readyTimeoutMs = READY_TIMEOUT_MS }) {
  if (!redisUrl) throw new Error('REDIS_URL is required for the review queue');
  let closing = false;
  const connection = redisConnection(redisUrl, () => closing);
  const queue = new Queue(name, { connection });
  const events = new QueueEvents(name, { connection });
  const worker = new Worker(name, async (job) => {
    const { body, agent } = job.data;
    return aiFetch(`/review/${agent}`, { method: 'POST', body: JSON.stringify(body) });
  }, { connection, concurrency: 12 });
  let warned = false;
  const onError = (error) => { if (!warned) { warned = true; console.warn('review queue: Redis error:', error?.message || error); } };
  for (const part of [queue, events, worker]) part.on('error', onError);

  async function run(body, emit) {
    const started = Date.now();
    const jobs = await withTimeout((async () => {
      await Promise.all([queue.waitUntilReady(), events.waitUntilReady(), worker.waitUntilReady()]);
      return queue.addBulk(AGENTS.map((agent) => ({
        name: `review-${agent}`,
        data: { agent, body },
        opts: { jobId: `${randomUUID()}-${agent}`, removeOnComplete: true, removeOnFail: true },
      })));
    })(), readyTimeoutMs, 'queue_unavailable');
    let firstAgentMs = null;
    const results = await Promise.all(jobs.map(async (job) => {
      let result;
      try {
        result = await job.waitUntilFinished(events, 65000);
        if (!result || result.agent !== job.data.agent) throw new Error('invalid_agent_result');
      } catch (error) {
        result = { agent: job.data.agent, status: 'failed', findings: [], latency_ms: 0,
          retries: 0, mode: 'rules', dropped: 0, error: String(error?.message || error).slice(0, 200) };
      }
      firstAgentMs ??= Date.now() - started;
      emit?.('agent', result);
      return result;
    }));
    const timing = { first_agent_ms: firstAgentMs, total_ms: Date.now() - started };
    const result = await aiFetch('/merge', { method: 'POST', body: JSON.stringify({
      text: body.text, agents: results, calibration: body.calibration || {}, timing,
    }) });
    return result;
  }

  // With Redis gone a graceful close would wait for connections that never answer. Setting `closing` makes the
  // reconnect loop stop, so every pending close settles; the race is only a safety net.
  async function close() {
    closing = true;
    const graceful = Promise.allSettled([worker.close(true), events.close(), queue.close()]);
    await Promise.race([graceful, new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
  }

  return { run, close };
}
