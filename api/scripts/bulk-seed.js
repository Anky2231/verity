// Fills a throwaway in-process database with many reviews and times the API's main queries before and after
// migration 004_indexes.sql. It never touches the demo data.
//   node scripts/bulk-seed.js [--reviews 20000] [--runs 7]
// The audit rows are inserted for volume only: their hashes are placeholders, so the chain would not verify.
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
const N = arg('reviews', 20000), RUNS = arg('runs', 7);
const INDEXES = ['audit_review_idx', 'decisions_review_idx', 'comments_review_idx', 'reviews_creator_idx', 'reviews_updated_idx'];
const MIGRATION = fs.readFileSync(new URL('../migrations/004_indexes.sql', import.meta.url), 'utf8');
const ID = Math.floor(N / 2);   // a review in the middle of the table

const QUERIES = {
  'review list, manager (all rows, as today)': [`SELECT r.*, u.name AS creator_name,
      (SELECT jsonb_build_object('number', v.number, 'score', v.score, 'flags', v.result) FROM revisions v WHERE v.review_id=r.id ORDER BY v.number DESC LIMIT 1) AS latest,
      (SELECT v.result FROM revisions v WHERE v.review_id=r.id ORDER BY v.number DESC OFFSET 1 LIMIT 1) AS prev
    FROM reviews r JOIN users u ON u.id=r.creator_id WHERE r.brand_id=$1 AND $2::text IS NOT NULL ORDER BY r.updated_at DESC`, ['lumina', 'u_rajan']],
  'review list, manager (first 50)': [`SELECT r.*, u.name AS creator_name FROM reviews r JOIN users u ON u.id=r.creator_id
    WHERE r.brand_id=$1 AND $2::text IS NOT NULL ORDER BY r.updated_at DESC LIMIT 50`, ['lumina', 'u_rajan']],
  'review list, creator (own reviews, first 50)': [`SELECT r.*, u.name AS creator_name FROM reviews r JOIN users u ON u.id=r.creator_id
    WHERE r.brand_id=$1 AND r.creator_id=$2 ORDER BY r.updated_at DESC LIMIT 50`, ['lumina', 'u_dev']],
  'audit trail for one review': [`SELECT id, review_id, actor_id, action, ts, hash FROM audit_log WHERE brand_id=$1 AND review_id=$2 ORDER BY id`, ['lumina', ID]],
  'flag decisions of one review': [`SELECT d.*, u.name FROM flag_decisions d JOIN users u ON u.id=d.actor_id WHERE review_id=$1 ORDER BY d.id`, [ID]],
  'comments of one review': [`SELECT c.*, u.name FROM comments c JOIN users u ON u.id=c.author_id WHERE review_id=$1 ORDER BY c.id`, [ID]],
  'calibration (decisions per rule)': [`SELECT rule_id, count(*)::int FROM flag_decisions WHERE brand_id=$1 AND rule_id IS NOT NULL GROUP BY rule_id`, ['lumina']],
  'analytics: hours to approve': [`SELECT avg(extract(epoch FROM (a.ts::timestamptz - s.ts::timestamptz)) / 3600) FROM
      (SELECT review_id, min(ts) AS ts FROM audit_log WHERE brand_id=$1 AND action='review.submit' GROUP BY review_id) s
      JOIN (SELECT review_id, min(ts) AS ts FROM audit_log WHERE brand_id=$1 AND action IN ('review.approve','review.final_approve') GROUP BY review_id) a USING (review_id)`, ['lumina']],
  'analytics: weekly score trend': [`SELECT to_char(date_trunc('week', r.created_at), 'YYYY-MM-DD') AS week, round(avg(l.score))::int, count(*)::int
      FROM reviews r JOIN LATERAL (SELECT score FROM revisions WHERE review_id=r.id ORDER BY number DESC LIMIT 1) l ON true WHERE r.brand_id=$1 GROUP BY 1 ORDER BY 1`, ['lumina']],
};

async function fill(db) {
  const t = Date.now();
  await db.exec(`
    INSERT INTO reviews (brand_id, big_version, title, content_type, creator_id, status, created_at, updated_at)
    SELECT 'lumina', 1, 'Bulk review ' || g, (ARRAY['blog','social','email'])[1 + g % 3], (ARRAY['u_maya','u_dev','u_rajan'])[1 + g % 3],
           (ARRAY['draft','submitted','approved','changes_requested'])[1 + g % 4],
           now() - (g || ' minutes')::interval * 7, now() - (g || ' minutes')::interval * 3
    FROM generate_series(1, ${N}) g;
    INSERT INTO revisions (review_id, brand_id, number, text, score, result)
    SELECT r.id, 'lumina', n, 'Sample text for review ' || r.id, 60 + (r.id + n) % 40, '{"highlights":[]}'::jsonb
    FROM reviews r, generate_series(1, 2) n;
    INSERT INTO flag_decisions (review_id, revision_number, brand_id, flag_key, rule_id, agent, decision, reason, actor_id)
    SELECT r.id, 1, 'lumina', 'k' || n, 'rule_' || (r.id + n) % 12, 'tone', (ARRAY['accepted','disputed','overridden'])[1 + (r.id + n) % 3], 'because', 'u_maya'
    FROM reviews r, generate_series(1, 3) n;
    INSERT INTO comments (review_id, brand_id, author_id, body) SELECT id, 'lumina', 'u_rajan', 'Looks fine' FROM reviews;
    INSERT INTO audit_log (brand_id, review_id, actor_id, actor_role, action, detail, ts, prev_hash, hash)
    SELECT 'lumina', r.id, 'u_maya', 'creator', (ARRAY['review.created','review.ran','review.submit','review.approve','comment.added'])[n], '{}'::jsonb,
           (now() - (r.id || ' minutes')::interval + (n || ' minutes')::interval)::text,
           'bulk-' || (r.id * 5 + n - 1), 'bulk-' || (r.id * 5 + n)
    FROM reviews r, generate_series(1, 5) n;
    ANALYZE;`);
  return Date.now() - t;
}

async function time(db, label, [sql, params]) {
  const runs = [];
  let plan = '';
  for (let i = 0; i < RUNS; i++) {
    const rows = await db.query(`EXPLAIN (ANALYZE, FORMAT TEXT) ${sql}`, params);
    const lines = rows.map((r) => r['QUERY PLAN']);
    runs.push(Number(/Execution Time: ([\d.]+) ms/.exec(lines.join('\n'))[1]));
    plan = [...new Set(lines.filter((l) => /Scan/.test(l)).map((l) => l.replace(/^[\s>-]+/, '').replace(/\s+\(cost.*$/, '').replace(/ on (\w+)( \w+)?$/, ' on $1')))].join('; ');
  }
  runs.sort((a, b) => a - b);
  return { label, ms: runs[Math.floor(runs.length / 2)], plan };
}

const db = await openDb({ url: '' });
await seed(db);
await db.query(`INSERT INTO users (id, org_id, name, email, role) VALUES ('u_dev','org_demo','Dev','dev@example.test','creator') ON CONFLICT DO NOTHING`);
const took = await fill(db);
const counts = {};
for (const t of ['reviews', 'revisions', 'flag_decisions', 'comments', 'audit_log']) counts[t] = (await db.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n;
console.log(`Loaded ${JSON.stringify(counts)} in ${(took / 1000).toFixed(1)} s (PGlite, in-process Postgres)\n`);

for (const i of INDEXES) await db.exec(`DROP INDEX IF EXISTS ${i}`);
await db.exec('ANALYZE');
const before = [];
for (const [label, q] of Object.entries(QUERIES)) before.push(await time(db, label, q));
await db.exec(MIGRATION); await db.exec('ANALYZE');
const after = [];
for (const [label, q] of Object.entries(QUERIES)) after.push(await time(db, label, q));

console.log(`| Query | Before (ms) | After (ms) | Plan before | Plan after |\n|---|---|---|---|---|`);
before.forEach((b, i) => console.log(`| ${b.label} | ${b.ms.toFixed(2)} | ${after[i].ms.toFixed(2)} | ${b.plan} | ${after[i].plan} |`));
console.log(`\nMedian of ${RUNS} runs of EXPLAIN ANALYZE per query.`);
await db.close();
