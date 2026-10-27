// Brand context for multi-brand workspaces. After requireAuth, this resolves which brand the request acts on and the
// caller's role *in that brand* from brand_memberships, so every route below it can use req.brand and req.user.role
// without caring how many brands exist. A brand the user does not belong to, and a brand that does not exist, give the
// same 403, so the response never confirms whether another brand is there.
export const BRAND_HEADER = 'x-brand-id';

export const brandContext = (db) => async (req, res, next) => {
  try {
    const memberships = await db.query('SELECT brand_id, role FROM brand_memberships WHERE user_id=$1 ORDER BY id', [req.user.sub]);
    if (!memberships.length) return res.status(403).json({ error: 'no_brand_access', detail: 'this user does not belong to any brand' });
    const wanted = req.get(BRAND_HEADER);
    const m = wanted ? memberships.find((x) => x.brand_id === wanted) : memberships[0];
    if (!m) return res.status(403).json({ error: 'brand_forbidden', detail: 'you do not have access to that brand' });
    req.brand = m.brand_id;
    req.user = { ...req.user, role: m.role };      // the role in this brand replaces the demo login's default role
    next();
  } catch (e) { next(e); }
};
