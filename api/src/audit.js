// Append-only hash chain, computed in one SQL statement so concurrent writers can't fork it.
const HASH_SQL = (prev) => `encode(sha256(convert_to(${prev} || '|' || $2::text || '|' || coalesce($3,'') || '|' ||
  coalesce($5::bigint::text,'') || '|' || $6::jsonb::text || '|' || $7, 'utf8')), 'hex')`;

export async function audit(db, { brandId, reviewId = null, actor, action, detail = {}, ts = new Date().toISOString() }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.query(
        `WITH p AS (SELECT coalesce((SELECT hash FROM audit_log WHERE brand_id=$1 ORDER BY id DESC LIMIT 1), 'genesis') AS prev)
         INSERT INTO audit_log (brand_id, review_id, actor_id, actor_role, action, detail, ts, prev_hash, hash)
         SELECT $1, $5::bigint, $3, $4, $2, $6::jsonb, $7, p.prev, ${HASH_SQL('p.prev')} FROM p`,
        [brandId, action, actor?.sub ?? null, actor?.role ?? null, reviewId, JSON.stringify(detail), ts]);
      return;
    } catch (e) {
      if (!/unique|duplicate/i.test(e.message) || attempt === 4) throw e; // chain fork -> retry
    }
  }
}

// Recomputes every hash; returns the first broken row (or null).
export async function verifyChain(db, brandId) {
  const rows = await db.query(
    `SELECT id, brand_id, review_id, actor_id, action, detail, ts, prev_hash, hash FROM audit_log WHERE brand_id=$1 ORDER BY id`, [brandId]);
  let prev = 'genesis';
  for (const r of rows) {
    const [{ h }] = await db.query(
      `SELECT encode(sha256(convert_to($1 || '|' || $2 || '|' || coalesce($3,'') || '|' || coalesce($4::text,'') || '|' || $5::jsonb::text || '|' || $6, 'utf8')), 'hex') AS h`,
      [prev, r.action, r.actor_id, r.review_id, JSON.stringify(r.detail), r.ts]);
    if (r.prev_hash !== prev || r.hash !== h) return { ok: false, brokenAt: r.id, checked: rows.length };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}
