export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// The brand the person is working in, sent on every call so the API scopes the request to it.
export const brandHeader = () => {
  try { const b = localStorage.getItem('verity_brand'); return b ? { 'x-brand-id': b } : {}; } catch { return {}; }
};

export class ApiError extends Error {
  constructor(status, path, body) { super(`${status} ${path}`); this.status = status; this.body = body; }
}

export async function api(path, { token, ...opts } = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...brandHeader(), ...opts.headers },
  });
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    throw new ApiError(res.status, path, body);
  }
  return res.json();
}

// Reads a text/event-stream POST response (EventSource cannot POST) and calls onEvent(name, data).
export async function postStream(path, { token, body, onEvent }) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...brandHeader() },
  });
  if (!res.ok) {
    let b = null;
    try { b = await res.json(); } catch { /* not JSON */ }
    throw new ApiError(res.status, path, { ...b, retryAfter: res.headers.get('retry-after') });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (ev && data) onEvent(ev, JSON.parse(data));
    }
  }
}

// Plain-English message for an API failure.
export function explain(e, fallback = 'Something went wrong. Please try again.') {
  const code = e?.body?.error;
  if (e?.status === 429) return `You are going a bit fast. Try again in ${e.body?.retry_after ?? e.body?.retryAfter ?? 'a few'} seconds.`;
  if (code === 'ai_unavailable' || e?.status === 502) return 'The review service is not reachable right now. Please retry in a moment.';
  if (code === 'unreadable_file') return 'We could not read that file. Use a text-based PDF, DOCX, TXT or MD file.';
  if (code === 'invalid_state') return 'That is not possible in the current state of the review.';
  if (code === 'self_approval_forbidden') return 'You cannot approve content you created.';
  if (code === 'reason_required') return 'A reason is required for that action.';
  if (code === 'run_review_first') return 'Run a review before submitting.';
  if (e?.status === 403) return 'Your role is not allowed to do that.';
  if (e?.status === 401) return 'Your session expired. Please choose a role again.';
  return fallback;
}
