// Measures the drift detector on simulated teams: how often it stays quiet on a stable team, and how fast it notices a
// planted drift. Seeds 1-300 are the development set (used to choose the threshold); seeds 1001-1500 are held out and
// never used to tune anything.   node scripts/drift-eval.js [--threshold 3]
import { weeklySeries, firstAlert, WINDOW_WEEKS, BASELINE_WEEKS } from '../src/drift.js';
import * as drift from '../src/drift.js';
import { simulateTeam } from '../src/drift-sim.js';

const DRIFT_START = 6;
const run = (opts) => firstAlert(weeklySeries(simulateTeam(opts)));
const seeds = (from, n) => Array.from({ length: n }, (_, i) => from + i);

export function evaluate(from, n, label) {
  const stable = seeds(from, n).map((seed) => run({ seed, weeks: 12 }));
  const falseAlerts = stable.filter(Boolean).length;
  const scenarios = {
    'step to 2.2x': { factor: 2.2, ramp: 0 },
    'ramp to 2.2x over 4 weeks': { factor: 2.2, ramp: 4 },
    'step to 1.6x (mild)': { factor: 1.6, ramp: 0 },
  };
  const rows = Object.entries(scenarios).map(([name, o]) => {
    const alerts = seeds(from, n).map((seed) => run({ seed, weeks: 12, driftStart: DRIFT_START, ...o }));
    const early = alerts.filter((a) => a && a.index < DRIFT_START).length;          // fired before the drift began
    const delays = alerts.filter((a) => a && a.index >= DRIFT_START).map((a) => a.index - DRIFT_START).sort((a, b) => a - b);
    const within = delays.filter((d) => d <= WINDOW_WEEKS).length;
    return { name, detected: alerts.filter(Boolean).length, within, early, median: delays.length ? delays[Math.floor(delays.length / 2)] : null };
  });
  console.log(`\n${label}: ${n} simulated teams per scenario, 12 weeks, drift (when planted) from week ${DRIFT_START}, baseline ${BASELINE_WEEKS} weeks, window ${WINDOW_WEEKS} weeks, threshold ${drift.THRESHOLD}`);
  console.log(`  stable teams that raised an alert: ${falseAlerts}/${n} = ${((falseAlerts / n) * 100).toFixed(1)}%`);
  for (const r of rows)
    console.log(`  ${r.name.padEnd(28)} detected ${String(r.detected).padStart(3)}/${n}, within ${WINDOW_WEEKS} weeks of the start ${String(r.within).padStart(3)}/${n} (${((r.within / n) * 100).toFixed(0)}%), median delay ${r.median} weeks, alerts before the drift ${r.early}`);
  return { falseAlerts, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  evaluate(1, 300, 'DEV');
  evaluate(1001, 500, 'HELD-OUT');
}
