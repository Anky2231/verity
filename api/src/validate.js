// Input rules shared by the routes. Each returns an error object { error, detail } or null.
export const CONTENT_TYPES = ['blog', 'social', 'email'];
export const DECISIONS = ['accepted', 'disputed', 'overridden', 'manual'];
export const LIMITS = { title: 200, comment: 2000, reason: 1000, flagKey: 200 };

const bad = (error, detail) => ({ error, detail });

export function validateNewReview(body = {}) {
  if (body.title != null && typeof body.title !== 'string') return bad('invalid_title', 'title must be text');
  if ((body.title ?? '').trim().length > LIMITS.title) return bad('title_too_long', `title is at most ${LIMITS.title} characters`);
  if (body.content_type != null && !CONTENT_TYPES.includes(body.content_type))
    return bad('invalid_content_type', `content_type must be one of: ${CONTENT_TYPES.join(', ')}`);
  return null;
}

export function validateComment(body = {}) {
  if (typeof body.body !== 'string' || !body.body.trim()) return bad('body_required', 'a comment cannot be empty');
  if (body.body.trim().length > LIMITS.comment) return bad('comment_too_long', `a comment is at most ${LIMITS.comment} characters`);
  return null;
}

export function validateDecision(b = {}) {
  if (!DECISIONS.includes(b.decision)) return bad('invalid_decision', `decision must be one of: ${DECISIONS.join(', ')}`);
  if (typeof b.flag_key !== 'string' || !b.flag_key || !Number.isInteger(b.revision) || b.revision < 1)
    return bad('flag_key_and_revision_required', 'send flag_key (text) and revision (a whole number from 1)');
  if (b.flag_key.length > LIMITS.flagKey) return bad('flag_key_too_long', `flag_key is at most ${LIMITS.flagKey} characters`);
  for (const k of ['rule_id', 'agent', 'quoted_text', 'reason'])
    if (b[k] != null && typeof b[k] !== 'string') return bad(`invalid_${k}`, `${k} must be text`);
  if ((b.reason ?? '').length > LIMITS.reason) return bad('reason_too_long', `reason is at most ${LIMITS.reason} characters`);
  if (b.quoted_text && b.quoted_text.length > 2000) return bad('quoted_text_too_long', 'quoted_text is at most 2000 characters');
  return null;
}

export function validateReason(reason) {
  if (reason != null && typeof reason !== 'string') return bad('invalid_reason', 'reason must be text');
  if ((reason ?? '').length > LIMITS.reason) return bad('reason_too_long', `reason is at most ${LIMITS.reason} characters`);
  return null;
}
