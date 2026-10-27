import { audit } from './audit.js';
import { prng, buildRevision, CLEAN, TERM, CLAIM, CLAIMS, TONE } from './seed-history.js';

// Ten weeks of reviews from three teams at Lumina, so the Drift page has something real to analyse.
// Social drifts: from week 6 its writers slip back into jargon (Voice §1.2) and the violation rate rises about 3 times.
// Email and Blog stay steady. Deterministic, idempotent, and every result is marked `seeded: true`.
const BRAND = 'lumina';
const WEEKS = 10, DRIFT_START = 6, DRIFT_FACTOR = 3.5, BASE_RATE = 3.0;   // violations per 100 words
const PEOPLE = [
  { id: 'u_leo', name: 'Leo', team: 'Social', per: 4 }, { id: 'u_sam', name: 'Sam', team: 'Social', per: 0 },
  { id: 'u_priya', name: 'Priya', team: 'Email', per: 3 }, { id: 'u_hana', name: 'Hana', team: 'Blog', per: 3 },
];
const TITLES = { Social: ['Instagram caption', 'Story script', 'Launch teaser', 'Campaign post'], Email: ['Newsletter', 'Promo email', 'Welcome series', 'Wholesale update'], Blog: ['Blog post', 'Origin story', 'Brewing guide', 'Sustainability note'] };
const MANAGER = { sub: 'u_rajan', role: 'manager' };

const poisson = (rnd, mean) => { const L = Math.exp(-mean); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };

// One violating sentence of a given kind, in the shape buildRevision expects.
function violation(kind, rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  if (kind === 'jargon') { const x = pick(TONE.slice(0, 2)); return { t: x.t, fix: pick(CLEAN), flag: { agent: 'tone', id: x.id, cite: x.cite, q: x.q, conf: 0.75, sev: x.sev, why: x.why, sug: 'Say it simply and warmly.', rep: null } }; }
  if (kind === 'shout') { const x = TONE[2]; return { t: x.t, fix: pick(CLEAN), flag: { agent: 'tone', id: x.id, cite: x.cite, q: x.q, conf: 0.75, sev: x.sev, why: x.why, sug: 'Say it simply and warmly.', rep: null } }; }
  if (kind === 'term') { const x = pick(TERM); return { t: x.t, fix: x.t.replace(x.q, x.fix), flag: { agent: 'term', id: x.id, cite: x.cite, q: x.q, conf: 0.95, sev: 'medium', why: `'${x.q}' is not an approved term.`, sug: x.fix, rep: x.fix } }; }
  const x = pick(CLAIM), c = x.claim && CLAIMS[x.claim];
  return { t: x.t, fix: pick(CLEAN), flag: { agent: 'claim', id: 'r_claim_1', cite: 'Claims §3.1', q: x.q, conf: x.conf, sev: 'high', why: c ? `Only partially matches approved claim '${c.text}'.` : 'No approved claim supports this statement.', sug: c ? `Use approved wording: "${c.text}"` : 'Remove the claim or have Legal add it to the approved claims register.', rep: c?.text ?? null, ref: c?.ref ?? null } };
}

const mondayOf = (ms) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.getTime(); };

export async function seedDrift(db) {
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM reviews WHERE creator_id = ANY($1::text[])`, [PEOPLE.map((p) => p.id)]);
  if (n > 0) return;
  for (const p of PEOPLE) {
    await db.query(`INSERT INTO users (id, org_id, name, email, role) VALUES ($1,'org_demo',$2,$3,'creator') ON CONFLICT DO NOTHING`, [p.id, p.name, `${p.name.toLowerCase()}@demo`]);
    await db.query(`INSERT INTO brand_memberships (user_id, brand_id, role, team) VALUES ($1,$2,'creator',$3) ON CONFLICT DO NOTHING`, [p.id, BRAND, p.team]);
  }
  await db.query(`UPDATE brand_memberships SET team='Content' WHERE user_id='u_maya' AND brand_id=$1 AND team IS NULL`, [BRAND]);

  const rnd = prng(2027), pick = (a) => a[Math.floor(rnd() * a.length)];
  const thisWeek = mondayOf(Date.now());
  let reviewNo = 0;
  for (let w = 0; w < WEEKS; w++) {
    const weekStart = thisWeek - (WEEKS - w) * 7 * 86400000;   // the last full week ends just before this one
    for (const person of PEOPLE) {
      const count = person.id === 'u_sam' ? (rnd() < 0.5 ? 1 : 0) : Math.max(1, poisson(rnd, person.per - 1) + 1 - (rnd() < 0.3 ? 1 : 0));
      for (let i = 0; i < count; i++) {
        const team = person.team, drifted = team === 'Social' && w >= DRIFT_START;
        const sents = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({ t: pick(CLEAN) }));
        const words = sents.reduce((a, s) => a + s.t.split(/\s+/).length, 0);
        const kinds = [];
        for (let k = poisson(rnd, (BASE_RATE * words) / 100); k > 0; k--) kinds.push(pick(['jargon', 'shout', 'term', 'claim']));
        if (drifted) for (let k = poisson(rnd, (BASE_RATE * (DRIFT_FACTOR - 1) * words) / 100); k > 0; k--) kinds.push('jargon');
        for (const kind of kinds) sents.splice(1 + Math.floor(rnd() * sents.length), 0, violation(kind, rnd));
        const rev = buildRevision(sents);
        const at0 = weekStart + Math.floor(rnd() * 4) * 86400000 + (8 + Math.floor(rnd() * 8)) * 3600000;
        const stamp = (mins) => new Date(at0 + mins * 60000).toISOString();
        const title = `${pick(TITLES[team])} #${++reviewNo}`;
        const actor = { sub: person.id, role: 'creator' };
        const [row] = await db.query(
          `INSERT INTO reviews (brand_id, big_version, title, content_type, creator_id, status, created_at, updated_at)
           VALUES ($1,1,$2,$3,$4,'published',$5,$6) RETURNING id`,
          [BRAND, title, { Social: 'social', Email: 'email', Blog: 'blog' }[team], person.id, stamp(0), stamp(300)]);
        await db.query('INSERT INTO revisions (review_id, brand_id, number, text, score, result, created_at) VALUES ($1,$2,1,$3,$4,$5::jsonb,$6)',
          [row.id, BRAND, rev.text, rev.result.score, JSON.stringify(rev.result), stamp(20)]);
        const log = (who, action, mins, detail = {}) => audit(db, { brandId: BRAND, reviewId: row.id, actor: who, action, detail, ts: stamp(mins) });
        await log(actor, 'review.created', 1, { title });
        await log(actor, 'review.ran', 20, { revision: 1, score: rev.result.score, flags: rev.result.highlights.length, big_version: 1, agents: rev.result.agents.map((a) => ({ agent: a.agent, status: a.status, mode: a.mode })) });
        await log(actor, 'review.submit', 60, { from: 'draft', to: 'submitted' });
        await log(MANAGER, 'review.approve', 180, { from: 'submitted', to: 'approved' });
        await log(MANAGER, 'review.publish', 300, { from: 'approved', to: 'published' });
      }
    }
  }
}
