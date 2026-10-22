import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';

const AGENTS = ['tone', 'term', 'claim'];
const QUEUE_NAME = 'verity-review-agents';

function redisConnection(redisUrl) {
  const url = new URL(redisUrl);
  const connection = {
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379)),
    maxRetriesPerRequest: null,
  };
  if (url.username) connection.username = decodeURIComponent(url.username);
  if (url.password) connection.password = decodeURIComponent(url.password);
  if (url.pathname.length > 1) connection.db = Number(url.pathname.slice(1));
  if (url.protocol === 'rediss:') connection.tls = {};
  return connection;
}

export function createReviewQueue({ aiFetch, redisUrl = process.env.REDIS_URL, name = QUEUE_NAME }) {
  if (!redisUrl) throw new Error('REDIS_URL is required for the review queue');
  const connection = redisConnection(redisUrl);
  const queue = new Queue(name, { connection });
  const events = new QueueEvents(name, { connection });
  const worker = new Worker(name, async (job) => {
    const { body, agent } = job.data;
    return aiFetch(`/review/${agent}`, { method: 'POST', body: JSON.stringify(body) });
  }, { connection, concurrency: 12 });

  async function run(body, emit) {
    const started = Date.now();
    await Promise.all([queue.waitUntilReady(), events.waitUntilReady(), worker.waitUntilReady()]);
    const jobs = await queue.addBulk(AGENTS.map((agent) => ({
      name: `review-${agent}`,
      data: { agent, body },
      opts: { jobId: `${randomUUID()}-${agent}`, removeOnComplete: true, removeOnFail: true },
    })));
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

  async function close() {
    await Promise.all([worker.close(), events.close(), queue.close()]);
  }

  return { run, close };
}
