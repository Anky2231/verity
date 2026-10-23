// Validates and sanitises a Brand Intelligence Graph before it becomes a new immutable version.
const SEV = ['low', 'medium', 'high', 'critical'];
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);

export function validateBig(input, { brandId, version }) {
  const errors = [];
  const ids = new Set();
  const uniq = (id, what) => { if (!id) errors.push(`${what}: id is required`); else if (ids.has(id)) errors.push(`duplicate id "${id}"`); ids.add(id); };

  const rules = list(input?.rules, 200).map((r, i) => {
    const x = { id: str(r.id, 40), clause_ref: str(r.clause_ref, 80), type: r.type, severity: r.severity, text: str(r.text, 1000) };
    uniq(x.id, `rule ${i + 1}`);
    if (!['tone', 'claim'].includes(x.type)) errors.push(`rule ${x.id || i + 1}: type must be tone or claim`);
    if (!SEV.includes(x.severity)) errors.push(`rule ${x.id || i + 1}: severity must be one of ${SEV.join(', ')}`);
    if (!x.text) errors.push(`rule ${x.id || i + 1}: text is required`);
    return x;
  });
  const glossary = list(input?.glossary, 500).map((g, i) => {
    const x = { id: str(g.id, 40), approved: str(g.approved, 80), banned: list(g.banned, 30).map((b) => str(b, 80)).filter(Boolean), reason: str(g.reason, 300) };
    const ctx = list(g.allowed_contexts, 20).map((c) => str(c, 80)).filter(Boolean);
    if (ctx.length) x.allowed_contexts = ctx;
    uniq(x.id, `term ${i + 1}`);
    if (!x.approved) errors.push(`term ${x.id || i + 1}: approved wording is required`);
    if (!x.banned.length) errors.push(`term ${x.id || i + 1}: at least one banned variant is required`);
    return x;
  });
  const claims = list(input?.claims, 500).map((c, i) => {
    const x = { id: str(c.id, 40), text: str(c.text, 500), source_doc: str(c.source_doc, 200), page: Number.isInteger(c.page) ? c.page : null };
    uniq(x.id, `claim ${i + 1}`);
    if (!x.text) errors.push(`claim ${x.id || i + 1}: text is required`);
    if (!x.source_doc) errors.push(`claim ${x.id || i + 1}: source document is required (every claim must be citable)`);
    return x;
  });
  const tp = input?.tone_profile ?? {};
  const tone_profile = { descriptors: list(tp.descriptors, 20).map((s) => str(s, 80)).filter(Boolean),
    do_examples: list(tp.do_examples, 20).map((s) => str(s, 300)).filter(Boolean), dont_examples: list(tp.dont_examples, 20).map((s) => str(s, 300)).filter(Boolean) };
  if (!rules.length && !glossary.length && !claims.length) errors.push('the guideline is empty: add at least one rule, term or claim');
  return { ok: errors.length === 0, errors, big: { brand_id: brandId, version, tone_profile, rules, glossary, claims } };
}

export const bigCounts = (b) => ({ rules: b.rules.length, terms: b.glossary.length, claims: b.claims.length });
