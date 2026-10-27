import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklySeries, baselineOf, scoreWindow, firstAlert, risingClauses, buildDrift, digestText, WINDOW_WEEKS, BASELINE_WEEKS } from '../src/drift.js';
import { simulateTeam } from '../src/drift-sim.js';

const review = (week, words, flags, clauses = {}) => ({ week, words, flags, clauses });

test('weekly series pools each week by words, fills quiet weeks, and can run on to a later week', () => {
  const s = weeklySeries([review('2026-01-05', 100, 2), review('2026-01-05', 100, 4), review('2026-01-19', 200, 2)]);
  assert.deepEqual(s.map((p) => [p.week, p.reviews, p.rate]), [['2026-01-05', 2, 3], ['2026-01-12', 0, null], ['2026-01-19', 1, 1]]);
  assert.equal(weeklySeries([review('2026-01-05', 100, 1)], '2026-02-02').length, 5);
  assert.deepEqual(weeklySeries([]), []);
});

test('a team without enough history has no baseline, so it is never judged', () => {
  assert.equal(baselineOf(weeklySeries([review('2026-01-05', 100, 3), review('2026-01-12', 100, 2)])), null);
  const few = [review('2026-01-05', 100, 2), review('2026-01-12', 100, 2), review('2026-01-19', 100, 2), review('2026-01-26', 100, 2), review('2026-01-26', 100, 2)];
  assert.equal(baselineOf(weeklySeries(few)), null, 'five reviews is below the minimum of six');
});

test('the score is how far the recent rate is above baseline in standard errors, and needs a real increase', () => {
  const reviews = [];
  for (let w = 0; w < 4; w++) for (let k = 0; k < 3; k++) reviews.push(review(`2026-0${w < 3 ? 1 : 2}-${['05', '12', '19', '02'][w]}`, 100, 2));
  for (const [week, flags] of [['2026-02-09', 6], ['2026-02-16', 6], ['2026-02-23', 6]]) for (let k = 0; k < 3; k++) reviews.push(review(week, 100, flags));
  const series = weeklySeries(reviews), base = baselineOf(series);
  assert.equal(base.mean, 2);
  const s = scoreWindow(series, base, series.length - 1);
  assert.equal(s.rate, 6); assert.equal(s.ratio, 3); assert.ok(s.z > 5 && s.drifting);
  const tiny = scoreWindow(weeklySeries([...reviews.slice(0, 12), ...[ '2026-02-09', '2026-02-16', '2026-02-23'].flatMap((w) => [review(w, 100, 2.2), review(w, 100, 2.2), review(w, 100, 2.2)])]), base, 6);
  assert.equal(tiny.drifting, false, 'a 10% rise is not an alert');
});

test('a window with too few reviews is not scored', () => {
  const series = weeklySeries([...Array.from({ length: 8 }, (_, i) => review(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'][i % 4], 100, 2)), review('2026-03-02', 100, 9)]);
  assert.equal(scoreWindow(series, baselineOf(series), series.length - 1), null, 'one review in the last three weeks is too little to judge');
});

// ---- Round 3 acceptance test, on reproducible simulations ----
test('ACCEPTANCE: a planted drift raises an alert within one window of its start; stable teams stay quiet', () => {
  const START = 6, N = 100;
  let detected = 0, within = 0, falseAlerts = 0, before = 0;
  for (let seed = 2001; seed < 2001 + N; seed++) {
    const planted = firstAlert(weeklySeries(simulateTeam({ seed, weeks: 12, driftStart: START, factor: 2.2 })));
    if (planted) { detected++; if (planted.index < START) before++; else if (planted.index - START <= WINDOW_WEEKS) within++; }
    if (firstAlert(weeklySeries(simulateTeam({ seed, weeks: 12 })))) falseAlerts++;
  }
  assert.ok(within / N >= 0.85, `alert within ${WINDOW_WEEKS} weeks for at least 85% of planted drifts, got ${within}/${N}`);
  assert.ok(falseAlerts / N <= 0.08, `at most 8% of stable teams may alert, got ${falseAlerts}/${N}`);
  assert.ok(before <= 3, `alerts before the drift began are false alarms, got ${before}`);
});

test('a drift raised from week 6 is not reported before week 6 on the same data', () => {
  for (let seed = 2001; seed < 2031; seed++) {
    const a = firstAlert(weeklySeries(simulateTeam({ seed, weeks: 12, driftStart: 6 })));
    const stableHead = firstAlert(weeklySeries(simulateTeam({ seed, weeks: 6 })));
    if (a && a.index < 6) assert.ok(stableHead, 'an early alert only happens where the stable data alone would also have alerted');
  }
});

test('rising clauses name where the extra violations are', () => {
  const reviews = simulateTeam({ seed: 7, weeks: 12, driftStart: 6, factor: 3 });
  const series = weeklySeries(reviews);
  const rising = risingClauses(reviews, series);
  assert.equal(rising[0].clause, 'Voice §1.2');
  assert.ok(rising[0].recent_rate > rising[0].baseline_rate * 1.5);
  assert.ok(!rising.some((c) => c.clause === 'Claims §3.1'), 'unchanged clauses are not predicted');
});

test('buildDrift marks the drifting team, leaves the stable one alone and says when there is too little history', () => {
  const social = simulateTeam({ seed: 11, weeks: 12, driftStart: 6, factor: 2.5 }).map((r) => ({ ...r, team: 'Social' }));
  const email = simulateTeam({ seed: 12, weeks: 12 }).map((r) => ({ ...r, team: 'Email' }));
  const newTeam = simulateTeam({ seed: 13, weeks: 2 }).map((r) => ({ ...r, team: 'New' }));
  const d = buildDrift([...social, ...email, ...newTeam]);
  const by = Object.fromEntries(d.teams.map((t) => [t.team, t]));
  assert.equal(by.Social.status, 'drifting'); assert.ok(by.Social.score >= 3.5 && by.Social.ratio >= 1.3);
  assert.ok(by.Social.rising_clauses.length >= 1);
  assert.equal(by.Email.status, 'stable'); assert.deepEqual(by.Email.rising_clauses, []);
  assert.equal(by.New.status, 'insufficient_data'); assert.equal(by.New.baseline, null);
  assert.equal(d.anchor_week, by.Social.series.at(-1).week);
  assert.equal(by.Social.series.length, by.Email.series.length, 'every team is shown on the same weeks');
});

test('a team that stopped writing is not scored on old data', () => {
  const social = simulateTeam({ seed: 11, weeks: 6 }).map((r) => ({ ...r, team: 'Quiet' }));
  const others = simulateTeam({ seed: 12, weeks: 12 }).map((r) => ({ ...r, team: 'Busy' }));
  const d = buildDrift([...social, ...others]);
  assert.equal(d.teams.find((t) => t.team === 'Quiet').status, 'insufficient_data');
});

test('no reviews at all gives an empty, explained result', () => {
  const d = buildDrift([]);
  assert.deepEqual(d.teams, []); assert.equal(d.anchor_week, null);
  assert.match(digestText(d, 'Lumina'), /nothing to compare/);
});

test('the digest names drifting teams, the likely next clauses and teams that cannot be judged yet', () => {
  const social = simulateTeam({ seed: 11, weeks: 12, driftStart: 6, factor: 2.5 }).map((r) => ({ ...r, team: 'Social' }));
  const newTeam = simulateTeam({ seed: 13, weeks: 2 }).map((r) => ({ ...r, team: 'New' }));
  const text = digestText(buildDrift([...social, ...newTeam]), 'Lumina Coffee Co.');
  assert.match(text, /^Lumina Coffee Co\.: drift digest for the week of 2026-/);
  assert.match(text, /Social is drifting: .* violations per 100 words/);
  assert.match(text, /Most likely next: Voice §1\.2/);
  assert.match(text, /Not enough history yet to judge: New\./);
  assert.ok(BASELINE_WEEKS === 4);
});
