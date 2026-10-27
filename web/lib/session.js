'use client';
import { useEffect, useState } from 'react';
import { api } from './api';

export const parseJwt = (t) => { try { return JSON.parse(atob(t.split('.')[1])); } catch { return null; } };
const read = (key) => { try { return localStorage.getItem(key) || null; } catch { return null; } };
const write = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* private mode */ } };
const readBrands = () => { try { return JSON.parse(read('verity_brands') || '[]'); } catch { return []; } };
const announce = () => window.dispatchEvent(new Event('verity:session'));

// token === undefined until the browser has been read (avoids a logged-out flash).
// `role` is the role in the active brand (a person can be a creator at one brand and a manager at another).
export function useSession() {
  const [state, setState] = useState({ token: undefined, brands: [], brandId: null });
  useEffect(() => {
    const sync = () => setState({ token: read('verity_token'), brands: readBrands(), brandId: read('verity_brand') });
    sync();
    window.addEventListener('verity:session', sync);
    return () => window.removeEventListener('verity:session', sync);
  }, []);
  const { token, brands, brandId } = state;
  const user = token ? parseJwt(token) : null;
  const brand = brands.find((b) => b.id === brandId) ?? brands[0] ?? null;
  return { token, user, brands, brand, role: brand?.role ?? user?.role ?? null, ready: token !== undefined };
}

// Chooses the brand to work in. Same person, different brand: the role and all data change with it.
export function switchBrand(id) { write('verity_brand', id); announce(); }

export async function loginAs(role) {
  const r = await api('/auth/demo-login', { method: 'POST', body: JSON.stringify({ role }) });
  write('verity_token', r.token);
  const brands = await api('/brands', { token: r.token }).catch(() => []);
  write('verity_brands', JSON.stringify(brands));
  const keep = brands.find((b) => b.id === read('verity_brand'));
  write('verity_brand', (keep ?? brands[0])?.id ?? null);
  announce();
  return r;
}
