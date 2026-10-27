import { audit } from './audit.js';

// Demo history so dashboards and queues are populated for first-time visitors.
// Deterministic (fixed PRNG), runs only on an empty reviews table, and marks results `seeded: true`.
const BRAND = 'lumina';
const U = {
  maya: { sub: 'u_maya', role: 'creator' }, rajan: { sub: 'u_rajan', role: 'manager' }, anita: { sub: 'u_anita', role: 'approver' },
};

export function prng(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const CLEAN = [
  'Our roasters pick every batch by hand.', 'Try it black first, then tell us what you taste.',
  'Our beans are sourced directly from 40 partner farms.', 'All packaging is 100% compostable.',
  'Roasted in small batches within 48 hours of shipping.', 'Come say hello at the Saturday market.',
  'The new seasonal blend is on the shelves today.', 'Brew it slowly and enjoy the first sip.',
];
export const TERM = [
  { t: 'Grab your morning java at Lumina.', q: 'java', id: 't_1', fix: 'coffee beans', cite: 'Terminology §2.1' },
  { t: 'Hand-picked joe, delivered fresh.', q: 'joe', id: 't_1', fix: 'coffee beans', cite: 'Terminology §2.1' },
  { t: 'Our consumers tell us the new roast is smooth.', q: 'consumers', id: 't_2', fix: 'customers', cite: 'Terminology §2.3' },
  { t: 'Great news for users who like it dark.', q: 'users', id: 't_2', fix: 'customers', cite: 'Terminology §2.3' },
  { t: 'Try our cheap beans this week.', q: 'cheap beans', id: 't_3', fix: 'ethically sourced', cite: 'Terminology §2.5' },
];
export const CLAIM = [
  { t: 'We are the best coffee in the world.', q: 'We are the best coffee in the world', conf: 0.85 },
  { t: 'Every cup is 100% carbon neutral.', q: 'Every cup is 100% carbon neutral', conf: 0.85 },
  { t: 'Every order ships in 48 hours.', q: 'Every order ships in 48 hours', conf: 0.65, claim: 'c_3' },
  { t: 'Our coffee cures morning grumpiness, guaranteed.', q: 'Our coffee cures morning grumpiness, guaranteed', conf: 0.85 },
];
export const CLAIMS = { c_3: { text: 'Roasted in small batches within 48 hours of shipping', ref: 'c_3 · Operations Handbook p.11' } };
export const TONE = [
  { t: 'We leverage synergistic roasting solutions.', q: 'leverage synergistic roasting solutions', id: 'r_voice_1', sev: 'medium', cite: 'Voice §1.2', why: 'Corporate jargon is off-voice.' },
  { t: 'Our best-in-class paradigm elevates your morning.', q: 'best-in-class paradigm', id: 'r_voice_1', sev: 'medium', cite: 'Voice §1.2', why: 'Corporate jargon is off-voice.' },
  { t: 'BUY NOW!!!', q: '!!!', id: 'r_voice_2', sev: 'low', cite: 'Voice §1.4', why: 'At most one exclamation mark.' },
];
const SEV_COST = { low: 3, medium: 8, high: 15, critical: 25 };
const TITLES = ['Spring blend launch post', 'Newsletter: Saturday market', 'Instagram caption: single origin', 'Wholesale partner email',
  'Blog: how we roast', 'Packaging copy: Ethiopia', 'Holiday gift guide', 'Cold brew product page', 'Loyalty programme announcement',
  'Café menu descriptions', 'Founder story page', 'Press release: new roastery', 'Sustainability update', 'Back-to-school promo',
  'Subscription box teaser', 'Event invite: cupping night'];

function finding(f, start, text) {
  return { agent: f.agent, rule_id: f.id, clause_citation: f.cite, span: { start, end: start + f.q.length }, quoted_text: f.q,
    confidence: f.conf, severity: f.sev, explanation: f.why, suggestion: f.sug ?? null, replacement: f.rep ?? null, source_ref: f.ref ?? null };
}

// sentences: [{t, flag?}] -> { text, result } in the same shape the AI service returns
export function buildRevision(sentences) {
  let text = ''; const found = [];
  for (const s of sentences) {
    if (text) text += ' ';
    if (s.flag) { const off = s.t.indexOf(s.flag.q); found.push(finding(s.flag, text.length + off, text)); }
    text += s.t;
  }
  found.sort((a, b) => a.span.start - b.span.start);
  const highlights = found.map((f) => ({ span: f.span, severity: f.severity, findings: [f] }));
  const score = Math.max(0, 100 - found.reduce((n, f) => n + Math.round(SEV_COST[f.severity] * Math.max(f.confidence, 0.6)), 0));
  const by = (a) => found.filter((f) => f.agent === a);
  const agents = ['claim', 'term', 'tone'].map((a) => ({ agent: a, status: 'ok', findings: by(a), latency_ms: 40, retries: 0, mode: 'fallback', dropped: 0 }));
  const top = highlights[0];
  const summary = found.length ? `${found.length} issue(s). Score ${score}/100. Prioritised by severity then confidence; most serious: ${top.severity} (${top.findings[0].agent}).`
    : 'No issues found. Content matches the brand guidelines.';
  return { text, result: { text, score, summary, highlights, agents, seeded: true } };
}

export async function seedHistory(db) {
  const [{ n }] = await db.query('SELECT count(*)::int AS n FROM reviews');
  if (n > 0) return;
  const rnd = prng(2026);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const N = 40;
  const statuses = [...Array(10).fill('published'), ...Array(9).fill('approved'), ...Array(6).fill('submitted'),
    ...Array(4).fill('escalated'), ...Array(5).fill('changes_requested'), ...Array(6).fill('draft')];
  for (let i = statuses.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [statuses[i], statuses[j]] = [statuses[j], statuses[i]]; }
  const dayMs = 86400000, start = Date.now() - 38 * dayMs;

  for (let i = 0; i < N; i++) {
    const status = statuses[i];
    let clock = start + i * 0.9 * dayMs + rnd() * 0.3 * dayMs;
    const at = (mins = 20 + Math.floor(rnd() * 90)) => new Date((clock += mins * 60000)).toISOString();
    const title = `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ` #${Math.floor(i / TITLES.length) + 1}` : ''}`;

    // Draft content: 3-4 sentences with 1-3 planted problems.
    const sents = [{ t: pick(CLEAN) }, { t: pick(CLEAN) }];
    const kinds = [pick(['term', 'term', 'claim', 'tone']), ...(rnd() < 0.6 ? [pick(['term', 'tone', 'claim'])] : []), ...(rnd() < 0.25 ? ['term'] : [])];
    for (const k of kinds) {
      if (k === 'term') { const x = pick(TERM); sents.push({ t: x.t, fix: x.t.replace(x.q, x.fix), flag: { agent: 'term', id: x.id, cite: x.cite, q: x.q, conf: 0.95, sev: 'medium',
        why: `'${x.q}' is not an approved term.`, sug: x.fix, rep: x.fix } }); }
      if (k === 'claim') { const x = pick(CLAIM); const c = x.claim && CLAIMS[x.claim]; sents.push({ t: x.t, fix: pick(CLEAN), flag: { agent: 'claim', id: 'r_claim_1', cite: 'Claims §3.1', q: x.q,
        conf: x.conf, sev: 'high', why: c ? `Only partially matches approved claim '${c.text}'.` : 'No approved claim supports this statement.',
        sug: c ? `Use approved wording: "${c.text}"` : 'Remove the claim or have Legal add it to the approved claims register.', rep: c?.text ?? null, ref: c?.ref ?? null } }); }
      if (k === 'tone') { const x = pick(TONE); sents.push({ t: x.t, fix: pick(CLEAN), flag: { agent: 'tone', id: x.id, cite: x.cite, q: x.q, conf: 0.7 + rnd() * 0.1, sev: x.sev, why: x.why,
        sug: 'Say it simply and warmly.', rep: null } }); }
    }
    sents.push({ t: pick(CLEAN) });
    const rev1 = buildRevision(sents);
    // Revision 2: the creator fixed what could be fixed.
    const fixedAll = status === 'approved' || status === 'published';
    const rev2 = buildRevision(sents.map((s) => (s.flag && (fixedAll || rnd() < 0.7) ? { t: s.fix } : s)));

    const [rv] = await db.query(
      `INSERT INTO reviews (brand_id, big_version, title, content_type, creator_id, status, created_at, updated_at)
       VALUES ($1,1,$2,$3,'u_maya','draft',$4,$4) RETURNING id`, [BRAND, title, pick(['blog', 'social', 'email']), new Date(clock).toISOString()]);
    const id = rv.id;
    const log = (actor, action, detail = {}) => audit(db, { brandId: BRAND, reviewId: id, actor, action, detail, ts: at(5) });
    const addRev = async (n, r) => {
      const ts = at(10);
      await db.query('INSERT INTO revisions (review_id, brand_id, number, text, score, result, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)',
        [id, BRAND, n, r.text, r.result.score, JSON.stringify(r.result), ts]);
      await audit(db, { brandId: BRAND, reviewId: id, actor: U.maya, action: 'review.ran', ts,
        detail: { revision: n, score: r.result.score, flags: r.result.highlights.length, big_version: 1,
          agents: r.result.agents.map((a) => ({ agent: a.agent, status: a.status, mode: a.mode })) } });
    };
    const decide = async (revN, hi, f, who, decision, reason) => {
      const ts = at(4);
      await db.query(`INSERT INTO flag_decisions (review_id, revision_number, brand_id, flag_key, rule_id, agent, quoted_text, decision, reason, actor_id, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, revN, BRAND, `${hi}-0`, f.rule_id, f.agent, f.quoted_text, decision, reason ?? null, who.sub, ts]);
      await audit(db, { brandId: BRAND, reviewId: id, actor: who, action: `flag.${decision}`, ts, detail: { revision: revN, flag_key: `${hi}-0`, rule_id: f.rule_id, agent: f.agent, reason } });
    };
    const comment = (who, body) => db.query('INSERT INTO comments (review_id, brand_id, author_id, body, created_at) VALUES ($1,$2,$3,$4,$5)', [id, BRAND, who.sub, body, at(3)]);
    const move = async (who, action, to, from, reason) => {
      await db.query('UPDATE reviews SET status=$1 WHERE id=$2', [to, id]);
      await audit(db, { brandId: BRAND, reviewId: id, actor: who, action: `review.${action}`, ts: at(15), detail: { from, to, reason } });
      if (reason) await comment(who, `[${action}] ${reason}`);
    };

    await log(U.maya, 'review.created', { title });
    await addRev(1, rev1);
    if (status === 'draft') { await db.query('UPDATE reviews SET updated_at=$1 WHERE id=$2', [at(1), id]); continue; }

    // Creator decisions on revision 1. Jargon rules are disputed often; the manager sometimes overrides them.
    const disputed = [];
    for (const [hi, h] of rev1.result.highlights.entries()) {
      const f = h.findings[0];
      if (f.rule_id === 'r_voice_1' && rnd() < 0.75) {
        await decide(1, hi, f, U.maya, 'disputed', 'Trade audience expects this phrasing.'); disputed.push([hi, f]);
      } else if (f.rule_id !== 'r_claim_1' || rnd() < 0.5) await decide(1, hi, f, U.maya, 'accepted');
    }
    const twoRevs = fixedAll || status === 'submitted' || rnd() < 0.4;
    if (twoRevs) await addRev(2, rev2);

    await move(U.maya, 'submit', 'submitted', 'draft');
    if (status === 'changes_requested') {
      await move(U.rajan, 'reject', 'changes_requested', 'submitted', pick(['Claim needs a source before we can approve.', 'Tone still reads corporate. Please simplify.', 'Please remove the unsupported superlative.'])); }
    if (status === 'escalated' || (fixedAll && rnd() < 0.3)) {
      await move(U.rajan, 'escalate', 'escalated', 'submitted');
      await comment(U.rajan, 'Escalating: unclear whether this phrasing is allowed for trade content.');
      if (status !== 'escalated') await move(U.anita, 'final_approve', 'approved', 'escalated');
    } else if (fixedAll) {
      for (const [hi, f] of disputed) if (rnd() < 0.6) await decide(1, hi, f, U.rajan, 'overridden', 'Jargon acceptable for this audience.');
      await move(U.rajan, 'approve', 'approved', 'submitted');
    }
    if (status === 'published') await move(U.rajan, 'publish', 'published', 'approved');
    await db.query('UPDATE reviews SET updated_at=$1 WHERE id=$2', [at(2), id]);
  }
  // A few unread notifications so the bell is not empty on first open.
  const queue = await db.query(`SELECT id, title, status, creator_id FROM reviews WHERE status IN ('submitted','escalated','changes_requested') ORDER BY id DESC LIMIT 6`);
  for (const q of queue) {
    const [to, msg] = q.status === 'submitted' ? ['u_rajan', `Maya submitted “${q.title}” for approval`]
      : q.status === 'escalated' ? ['u_anita', `“${q.title}” was escalated for final approval`] : [q.creator_id, `“${q.title}” needs changes`];
    await db.query('INSERT INTO notifications (brand_id, user_id, review_id, message) VALUES ($1,$2,$3,$4)', [BRAND, to, q.id, msg]);
  }
}
