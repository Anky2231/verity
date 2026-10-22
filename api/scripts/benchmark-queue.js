import { performance } from 'node:perf_hooks';
import { createReviewQueue } from '../src/queue.js';

if (!process.env.REDIS_URL) throw new Error('Set REDIS_URL to run the queue benchmark');
const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
const headers = { 'content-type': 'application/json', 'x-service-token': process.env.AI_SERVICE_TOKEN || '' };

async function aiFetch(path, init = {}) {
  const response = await fetch(`${aiUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(65000) });
  if (!response.ok) throw new Error(`AI service returned ${response.status}: ${await response.text()}`);
  return response.json();
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const sample = await aiFetch('/sample');
const wordSource = sample.content.split(/\s+/).filter(Boolean);
const words = Array.from({ length: 1032 }, (_, i) => wordSource[i % wordSource.length]);
const body = { revision_id: 'benchmark', brand_id: 'lumina', big_version: 1, content_type: 'blog',
  text: words.join(' '), big: sample.big, calibration: {} };
const queue = createReviewQueue({ aiFetch });

try {
  // Warm both paths, then compare end-to-end service and queue latency over ten runs.
  await aiFetch('/review', { method: 'POST', body: JSON.stringify(body) });
  await queue.run(body);
  const direct = [], queued = [];
  for (let i = 0; i < 10; i++) {
    let start = performance.now();
    await aiFetch('/review', { method: 'POST', body: JSON.stringify(body) });
    direct.push(performance.now() - start);
    start = performance.now();
    await queue.run(body);
    queued.push(performance.now() - start);
  }
  const directMedian = median(direct), queueMedian = median(queued);
  console.log(JSON.stringify({ words: body.text.split(/\s+/).length, runs: direct.length,
    direct_median_ms: Number(directMedian.toFixed(1)), queue_median_ms: Number(queueMedian.toFixed(1)),
    queue_overhead_median_ms: Number((queueMedian - directMedian).toFixed(1)),
    direct_runs_ms: direct.map((n) => Number(n.toFixed(1))), queue_runs_ms: queued.map((n) => Number(n.toFixed(1))) }, null, 2));
} finally {
  await queue.close();
}
