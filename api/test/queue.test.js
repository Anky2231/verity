import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createReviewQueue } from '../src/queue.js';

const enabled = Boolean(process.env.REDIS_URL);
const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
const serviceToken = process.env.AI_SERVICE_TOKEN || '';

async function callAi(path, init = {}) {
  const response = await fetch(`${aiUrl}${path}`, {
    method: init.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-service-token': serviceToken },
    body: init.body,
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`ai ${response.status}: ${await response.text()}`);
  return response.json();
}

const makeQueue = (aiFetch) => createReviewQueue({ aiFetch, name: `verity-test-${randomUUID()}` });

test('BullMQ runs the three agent jobs concurrently and streams each completion', { skip: !enabled }, async () => {
  let active = 0, peak = 0;
  const seen = [];
  const aiFetch = async (path, init) => {
    if (path === '/merge') return { agents: JSON.parse(init.body).agents };
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 100));
    active--;
    const agent = path.split('/').at(-1);
    return { agent, status: 'ok', findings: [], latency_ms: 100, retries: 0, mode: 'rules', dropped: 0 };
  };
  const queue = makeQueue(aiFetch);
  try {
    const output = await queue.run({ text: 'parallel check', calibration: {} }, (_event, result) => seen.push(result.agent));
    assert.equal(peak, 3);
    assert.deepEqual([...seen].sort(), ['claim', 'term', 'tone']);
    assert.equal(output.agents.length, 3);
  } finally { await queue.close(); }
});

test('queued sample result has the same findings and score as the in-process endpoint', { skip: !enabled }, async () => {
  const sample = await callAi('/sample');
  const body = { revision_id: 'queue-test', brand_id: 'lumina', text: sample.content, big: sample.big, calibration: {} };
  const baseline = await callAi('/review', { method: 'POST', body: JSON.stringify(body) });
  const queue = makeQueue(callAi);
  try {
    const result = await queue.run(body);
    assert.equal(result.score, baseline.score);
    assert.deepEqual(result.highlights, baseline.highlights);
  } finally { await queue.close(); }
});

test('a failed tone job becomes a failed agent result while other agents complete', { skip: !enabled }, async () => {
  const aiFetch = async (path, init) => {
    if (path === '/review/tone') throw new Error('ai 500');
    if (path.startsWith('/review/')) return { agent: path.split('/').at(-1), status: 'ok', findings: [], latency_ms: 4,
      retries: 0, mode: 'rules', dropped: 0 };
    const body = JSON.parse(init.body);
    return { agents: body.agents, score: 100 };
  };
  const queue = makeQueue(aiFetch);
  try {
    const result = await queue.run({ text: 'failure isolation', calibration: {} });
    const statuses = Object.fromEntries(result.agents.map((agent) => [agent.agent, agent.status]));
    assert.deepEqual(statuses, { claim: 'ok', term: 'ok', tone: 'failed' });
  } finally { await queue.close(); }
});
