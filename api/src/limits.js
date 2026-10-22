import crypto from 'node:crypto';

// Review cache keyed by content + BIG version + calibration: repeat clicks are instant and free.
export class LruCache {
  constructor(max = 200) { this.max = max; this.m = new Map(); }
  get(k) { if (!this.m.has(k)) return undefined; const v = this.m.get(k); this.m.delete(k); this.m.set(k, v); return v; }
  set(k, v) { this.m.delete(k); this.m.set(k, v); if (this.m.size > this.max) this.m.delete(this.m.keys().next().value); }
}
export const hashKey = (...parts) => crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');

// Sliding-window limiter (per process; fine for a single API instance).
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now(), recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return { ok: false, retryAfter: Math.ceil((windowMs - (now - recent[0])) / 1000) }; }
    recent.push(now); hits.set(key, recent); return { ok: true };
  };
}
