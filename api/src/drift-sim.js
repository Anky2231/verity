// A reproducible simulator of one team's weekly reviews, used to measure the drift detector (scripts/drift-eval.js and
// the tests) because real drift data does not exist for a new product. Violation counts are Poisson, like rare events.
export function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const poisson = (rnd, mean) => { const L = Math.exp(-mean); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };

export const CLAUSES = ['Voice §1.2', 'Voice §1.4', 'Terminology §2.1', 'Claims §3.1'];

// weeks: how many weeks to generate. driftStart: week index at which the rate starts to rise (null = stable control).
// ramp: weeks over which it climbs to `factor` times the base rate (0 = a step). Extra violations are all of one clause.
export function simulateTeam({ seed, weeks = 12, driftStart = null, ramp = 0, factor = 2.2, baseRate = 2.5, perWeek = 4, start = '2026-01-05' }) {
  const rnd = prng(seed), out = [], t0 = Date.parse(`${start}T00:00:00Z`);
  for (let w = 0; w < weeks; w++) {
    const progress = driftStart == null || w < driftStart ? 0 : ramp ? Math.min(1, (w - driftStart + 1) / ramp) : 1;
    const n = Math.max(1, poisson(rnd, perWeek));
    for (let i = 0; i < n; i++) {
      const words = 60 + Math.floor(rnd() * 60);
      const normal = poisson(rnd, (baseRate * words) / 100), extra = poisson(rnd, (baseRate * (factor - 1) * progress * words) / 100);
      const clauses = {};
      for (let k = 0; k < normal; k++) { const c = CLAUSES[Math.floor(rnd() * CLAUSES.length)]; clauses[c] = (clauses[c] ?? 0) + 1; }
      if (extra) clauses[CLAUSES[0]] = (clauses[CLAUSES[0]] ?? 0) + extra;
      out.push({ week: new Date(t0 + w * 7 * 86400000).toISOString().slice(0, 10), words, flags: normal + extra, clauses });
    }
  }
  return out;
}
