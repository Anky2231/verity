import test from 'node:test';
import assert from 'node:assert/strict';
import { pollUntilUp, GIVE_UP_MS, POLL_MS } from '../lib/wake.js';

const fakeClock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; }, get t() { return t; } }; };

test('returns at once, without sleeping, when the first check succeeds', async () => {
  const c = fakeClock(); let calls = 0;
  const h = await pollUntilUp({ ping: async () => { calls++; return { api: 'up' }; }, now: c.now, sleep: c.sleep });
  assert.deepEqual(h, { api: 'up' }); assert.equal(calls, 1); assert.equal(c.t, 0);
});

test('keeps trying every poll interval until the server answers', async () => {
  const c = fakeClock(); let calls = 0;
  const h = await pollUntilUp({ ping: async () => (++calls < 4 ? null : { api: 'up' }), now: c.now, sleep: c.sleep });
  assert.deepEqual(h, { api: 'up' }); assert.equal(calls, 4); assert.equal(c.t, 3 * POLL_MS);
});

test('gives up with null after the time limit and does not retry forever', async () => {
  const c = fakeClock(); let calls = 0;
  const h = await pollUntilUp({ ping: async () => { calls++; return null; }, now: c.now, sleep: c.sleep });
  assert.equal(h, null); assert.ok(c.t >= GIVE_UP_MS && c.t < GIVE_UP_MS + POLL_MS + 1); assert.ok(calls > 10 && calls < 100);
});

test('a custom limit and interval are respected', async () => {
  const c = fakeClock(); let calls = 0;
  assert.equal(await pollUntilUp({ ping: async () => { calls++; return null; }, now: c.now, sleep: c.sleep, giveUpMs: 1000, pollMs: 250 }), null);
  assert.equal(calls, 5);
});
