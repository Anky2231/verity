// Input rules shared by the routes. Each returns an error object { error, detail } or null.
export const CONTENT_TYPES = ['blog', 'social', 'email', 'image'];
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

// ---- Images and brand assets (VisualGuard) ----
export const MAX_IMAGE_BYTES = 6_000_000, MAX_LOGO_BYTES = 2_000_000, MAX_PALETTE = 24;
export const ASSET_KINDS = ['logo', 'retired_logo', 'palette'];

// The type is read from the file's first bytes, never from the name or the type the client claims.
const SIGNATURES = [
  ['image/png', (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/webp', (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
  ['image/gif', (b) => b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString())],
];
export const HEX = /^#[0-9a-f]{6}$/i;

// -> { error } or { bytes, mime }
export function readImageUpload(body, maxBytes) {
  if (typeof body?.content_base64 !== 'string' || !body.content_base64) return { error: bad('file_required', 'send the image as content_base64') };
  if (body.content_base64.length > Math.ceil(maxBytes * 4 / 3) + 16) return { error: bad('file_too_large', `the image can be at most ${Math.round(maxBytes / 1e6)} MB`), status: 413 };
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.content_base64)) return { error: bad('invalid_file', 'content_base64 is not valid base64') };
  const bytes = Buffer.from(body.content_base64, 'base64');
  if (bytes.length > maxBytes) return { error: bad('file_too_large', `the image can be at most ${Math.round(maxBytes / 1e6)} MB`), status: 413 };
  const mime = SIGNATURES.find(([, test]) => test(bytes))?.[0];
  if (!mime) return { error: bad('unsupported_image', 'use a PNG, JPEG, WebP or GIF image') };
  return { bytes, mime };
}

export function validateAssetMeta(b = {}) {
  if (!ASSET_KINDS.includes(b.kind)) return bad('invalid_kind', `kind must be one of: ${ASSET_KINDS.join(', ')}`);
  if (b.name != null && (typeof b.name !== 'string' || b.name.length > 60)) return bad('invalid_name', 'name must be text of at most 60 characters');
  if (b.kind === 'palette') {
    if (typeof b.hex !== 'string' || !HEX.test(b.hex)) return bad('invalid_hex', 'hex must look like #c77d0a');
    if (!b.name?.trim()) return bad('name_required', 'give the colour a name');
  } else if (typeof b.filename !== 'string' || !b.filename.trim() || b.filename.length > 200) return bad('invalid_filename', 'filename is required (at most 200 characters)');
  return null;
}
