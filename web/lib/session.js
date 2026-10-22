'use client';
import { useEffect, useState } from 'react';
import { api } from './api';

export const parseJwt = (t) => { try { return JSON.parse(atob(t.split('.')[1])); } catch { return null; } };
const read = () => { try { return localStorage.getItem('verity_token') || null; } catch { return null; } };

// token === undefined until the browser has been read (avoids a logged-out flash).
export function useSession() {
  const [token, setToken] = useState(undefined);
  useEffect(() => {
    const sync = () => setToken(read());
    sync();
    window.addEventListener('verity:session', sync);
    return () => window.removeEventListener('verity:session', sync);
  }, []);
  const user = token ? parseJwt(token) : null;
  return { token, user, role: user?.role ?? null, ready: token !== undefined };
}

export async function loginAs(role) {
  const r = await api('/auth/demo-login', { method: 'POST', body: JSON.stringify({ role }) });
  try { localStorage.setItem('verity_token', r.token); } catch { /* private mode */ }
  window.dispatchEvent(new Event('verity:session'));
  return r;
}
