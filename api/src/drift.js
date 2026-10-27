// Brand drift: are a team's reviews slowly moving away from the guidelines?
//
// Signal: violations per 100 words, per team and week (pooled over the week's reviews, so long and short posts weigh by
// length). A team's baseline is its own first BASELINE_WEEKS weeks. The recent window is the last WINDOW_WEEKS weeks up
// to the latest week with activity. The drift score is how many standard errors the recent rate sits above the baseline;
// a team is "drifting" only if the score passes THRESHOLD *and* the rate is at least MIN_RATIO times the baseline, so a
// statistically visible but trivial change does not raise an alert. Everything here is plain arithmetic on the stored
// reviews: no model, no cost, and every number can be recomputed by hand.
export const BASELINE_WEEKS = 4;
export const WINDOW_WEEKS = 3;
export const THRESHOLD = 3.0;
export const MIN_RATIO = 1.3;
export const MIN_BASELINE_REVIEWS = 6;
export const MIN_WINDOW_REVIEWS = 3;
const WEEK_MS = 7 * 86400000;

export const weekIndex = (week) => Math.round(Date.parse(`${week}T00:00:00Z`) / WEEK_MS);
export const weekLabel = (index) => new Date(index * WEEK_MS).toISOString().slice(0, 10);
const round = (x, d = 2) => (x == null ? null : +x.toFixed(d));

// reviews: [{ week: 'YYYY-MM-DD' (a Monday), words, flags, clauses: { 'Voice §1.2': 2 } }] for ONE team.
// -> contiguous weekly points from the first to the last week; weeks with no reviews have reviews 0 and rate null.
export function weeklySeries(reviews) {
  if (!reviews.length) return [];
  const byWeek = new Map();
  for (const r of reviews) {
    const i = weekIndex(r.week), w = byWeek.get(i) ?? { reviews: 0, words: 0, flags: 0 };
    w.reviews++; w.words += r.words; w.flags += r.flags; byWeek.set(i, w);
  }
  const indexes = [...byWeek.keys()], first = Math.min(...indexes), last = Math.max(...indexes);
  return Array.from({ length: last - first + 1 }, (_, k) => {
    const w = byWeek.get(first + k) ?? { reviews: 0, words: 0, flags: 0 };
    return { week: weekLabel(first + k), index: first + k, ...w, rate: w.words ? (w.flags / w.words) * 100 : null };
  });
}

const pooled = (points) => {
  const words = points.reduce((n, p) => n + p.words, 0), flags = points.reduce((n, p) => n + p.flags, 0);
  return { reviews: points.reduce((n, p) => n + p.reviews, 0), rate: words ? (flags / words) * 100 : null };
};

// A team's own reference period: its first BASELINE_WEEKS calendar weeks.
export function baselineOf(series) {
  const points = series.slice(0, BASELINE_WEEKS), withData = points.filter((p) => p.rate != null);
  const { reviews, rate } = pooled(points);
  if (reviews < MIN_BASELINE_REVIEWS || withData.length < 3) return null;
  const mean = rate, rates = withData.map((p) => p.rate);
  const m = rates.reduce((a, b) => a + b, 0) / rates.length;
  const sd = Math.sqrt(rates.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rates.length - 1));
  return { mean, sd: Math.max(sd, 0.25 * mean, 0.4), reviews, weeks: points.length };   // a floor stops a quiet baseline from making every wobble look huge
}

// Score the window of WINDOW_WEEKS weeks ending at series index `end`.
export function scoreWindow(series, base, end) {
  const window = series.slice(Math.max(0, end - WINDOW_WEEKS + 1), end + 1);
  const { reviews, rate } = pooled(window);
  if (!base || reviews < MIN_WINDOW_REVIEWS || rate == null) return null;
  const z = (rate - base.mean) / (base.sd / Math.sqrt(WINDOW_WEEKS));
  const ratio = base.mean > 0 ? rate / base.mean : (rate > 0 ? Infinity : 1);
  return { rate, z, ratio, reviews, drifting: z >= THRESHOLD && ratio >= MIN_RATIO };
}

// Walks the weeks after the baseline and returns the first one at which an alert would have fired (used to measure the detector).
export function firstAlert(series) {
  const base = baselineOf(series);
  if (!base) return null;
  for (let t = Math.min(BASELINE_WEEKS, series.length); t < series.length; t++) {
    const s = scoreWindow(series, base, t);
    if (s?.drifting) return { index: t, week: series[t].week, ...s };
  }
  return null;
}

// Clauses whose rate in the recent window is clearly above the baseline: where the next violations are most likely.
export function risingClauses(reviews, series) {
  if (!series.length) return [];
  const base = new Set(series.slice(0, BASELINE_WEEKS).map((p) => p.index));
  const last = series[series.length - 1].index, recentFrom = last - WINDOW_WEEKS + 1;
  const acc = { base: { words: 0, c: {} }, recent: { words: 0, c: {} } };
  for (const r of reviews) {
    const i = weekIndex(r.week), part = base.has(i) ? acc.base : i >= recentFrom ? acc.recent : null;
    if (!part) continue;
    part.words += r.words;
    for (const [clause, n] of Object.entries(r.clauses ?? {})) part.c[clause] = (part.c[clause] ?? 0) + n;
  }
  const rate = (part, clause) => (part.words ? ((part.c[clause] ?? 0) / part.words) * 100 : 0);
  return [...new Set([...Object.keys(acc.base.c), ...Object.keys(acc.recent.c)])]
    .map((clause) => ({ clause, baseline_rate: round(rate(acc.base, clause)), recent_rate: round(rate(acc.recent, clause)), recent_count: acc.recent.c[clause] ?? 0 }))
    .filter((c) => c.recent_count >= 3 && c.recent_rate - c.baseline_rate >= 0.3 && c.recent_rate >= 1.5 * c.baseline_rate)
    .sort((a, b) => (b.recent_rate - b.baseline_rate) - (a.recent_rate - a.baseline_rate));
}

// reviews: [{ team, week, words, flags, clauses }] for a whole brand. The analysis ends at the latest week that has any review.
export function buildDrift(reviews) {
  const teams = [...new Set(reviews.map((r) => r.team))].sort();
  const anchor = reviews.length ? weekLabel(Math.max(...reviews.map((r) => weekIndex(r.week)))) : null;
  const out = teams.map((team) => {
    const mine = reviews.filter((r) => r.team === team), series = weeklySeries(mine), base = baselineOf(series);
    // Every team is read up to the brand's latest week, so a team that went quiet is not scored on old data.
    const padded = anchor ? weeklySeries([...mine, { week: anchor, words: 0, flags: 0, clauses: {} }]).map((p, i, a) => (i === a.length - 1 && p.reviews === 1 && !mine.some((r) => r.week === anchor) ? { ...p, reviews: 0 } : p)) : series;
    const score = base ? scoreWindow(padded, base, padded.length - 1) : null;
    const status = !base || !score ? 'insufficient_data' : score.drifting ? 'drifting' : 'stable';
    return {
      team, status, reviews: mine.length,
      baseline: base && { rate: round(base.mean), reviews: base.reviews, weeks: base.weeks },
      recent: score && { rate: round(score.rate), reviews: score.reviews, weeks: WINDOW_WEEKS },
      score: score && round(score.z, 1), ratio: score && Number.isFinite(score.ratio) ? round(score.ratio) : null,
      series: padded.map((p) => ({ week: p.week, reviews: p.reviews, rate: round(p.rate) })),
      rising_clauses: status === 'drifting' ? risingClauses(mine, padded) : [],
    };
  });
  return { anchor_week: anchor, baseline_weeks: BASELINE_WEEKS, window_weeks: WINDOW_WEEKS, threshold: THRESHOLD, min_ratio: MIN_RATIO, teams: out };
}

// Plain-text digest for the week, suitable for a notification or an email.
export function digestText(d, brandName) {
  const drifting = d.teams.filter((t) => t.status === 'drifting');
  if (!d.anchor_week) return `${brandName}: no reviews yet, so there is nothing to compare.`;
  const lines = [`${brandName}: drift digest for the week of ${d.anchor_week}.`];
  if (!drifting.length) lines.push('No team is drifting from its baseline.');
  for (const t of drifting) {
    lines.push(`${t.team} is drifting: ${t.recent.rate} violations per 100 words over the last ${t.recent.weeks} weeks, against a baseline of ${t.baseline.rate} (${t.ratio}x, score ${t.score}).`);
    if (t.rising_clauses.length) lines.push(`  Most likely next: ${t.rising_clauses.slice(0, 3).map((c) => c.clause).join(', ')}.`);
  }
  const quiet = d.teams.filter((t) => t.status === 'insufficient_data').map((t) => t.team);
  if (quiet.length) lines.push(`Not enough history yet to judge: ${quiet.join(', ')}.`);
  return lines.join('\n');
}
