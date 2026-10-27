'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { loginAs, switchBrand, useSession } from '../lib/session';
import { ago } from '../lib/labels';

const NAV = {
  creator: [['/queue', 'My reviews'], ['/review', 'New review'], ['/visual', 'New image review']],
  manager: [['/queue', 'Queue'], ['/brand', 'Brand'], ['/dashboard', 'Dashboard'], ['/drift', 'Drift'], ['/audit', 'Audit']],
  approver: [['/queue', 'Queue'], ['/dashboard', 'Dashboard'], ['/drift', 'Drift'], ['/audit', 'Audit']],
  admin: [['/queue', 'Queue'], ['/brand', 'Brand'], ['/dashboard', 'Dashboard'], ['/drift', 'Drift'], ['/audit', 'Audit']],
};
const ROLES = [['creator', 'Maya', 'Creator'], ['manager', 'Rajan', 'Manager'], ['approver', 'Anita', 'Approver']];

export default function Header() {
  const { token, user, role, brands, brand } = useSession();
  const path = usePathname();
  const router = useRouter();
  const [note, setNote] = useState({ unread: 0, items: [] });
  const [menu, setMenu] = useState(null); // 'role' | 'bell' | null
  const box = useRef(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try { setNote(await api('/notifications', { token })); } catch { /* bell stays as is */ }
  }, [token]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 30000); return () => clearInterval(t); }, [refresh, path]);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setMenu(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function switchTo(r) {
    setMenu(null);
    try { await loginAs(r); router.push('/queue'); } catch { router.push('/'); }
  }
  function chooseBrand(id) {
    setMenu(null);
    // A full page load, so nothing from the previous brand (lists, open reviews, notifications) can stay on screen.
    if (id !== brand?.id) { switchBrand(id); window.location.assign('/queue'); }
  }
  async function openBell() {
    setMenu(menu === 'bell' ? null : 'bell');
    if (note.unread) { try { await api('/notifications/read', { token, method: 'POST' }); setTimeout(refresh, 400); } catch { /* ignore */ } }
  }

  const links = NAV[role] ?? [];
  return (
    <header className="topbar" ref={box}>
      <a href={token ? '/queue' : '/'} className="brandmark">Verity</a>
      <nav aria-label="Main" className="navlinks">
        {links.map(([href, label]) => <a key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</a>)}
      </nav>
      <span style={{ flex: 1 }} />
      {user && (
        <>
          {brands.length > 1 && (
            <div className="menuwrap">
              <button onClick={() => setMenu(menu === 'brand' ? null : 'brand')} aria-expanded={menu === 'brand'} aria-haspopup="menu" title="Switch brand">
                <span className="muted">Brand:</span> <b>{brand?.name}</b> ▾
              </button>
              {menu === 'brand' && (
                <div className="menu" role="menu">
                  <b style={{ padding: '4px 8px', display: 'block' }}>Switch brand</b>
                  {brands.map((b) => (
                    <button key={b.id} className="menuitem" role="menuitem" onClick={() => chooseBrand(b.id)} disabled={b.id === brand?.id}>
                      {b.name} · {b.role}{b.id === brand?.id ? ' (current)' : ''}
                    </button>))}
                </div>)}
            </div>)}
          <div className="menuwrap">
            <button className="iconbtn" onClick={openBell} aria-label={`Notifications, ${note.unread} unread`} aria-expanded={menu === 'bell'}>
              🔔{note.unread > 0 && <span className="dot">{note.unread}</span>}
            </button>
            {menu === 'bell' && (
              <div className="menu" role="menu" style={{ width: 320 }}>
                <b style={{ padding: '4px 8px', display: 'block' }}>Notifications</b>
                {note.items.length === 0 && <p className="muted" style={{ padding: '4px 8px' }}>Nothing yet. You will be told when a review needs you.</p>}
                {note.items.slice(0, 8).map((n) => (
                  <a key={n.id} className="menuitem" href={n.review_id ? `/review?id=${n.review_id}` : '#'} style={{ opacity: n.read ? 0.65 : 1 }}>
                    {n.message}<span className="muted"> · {ago(n.created_at)}</span>
                  </a>))}
              </div>)}
          </div>
          <div className="menuwrap">
            <button onClick={() => setMenu(menu === 'role' ? null : 'role')} aria-expanded={menu === 'role'} aria-haspopup="menu" title="Switch demo role">
              <span className="badge green" style={{ margin: 0 }}>{role}</span> {user.name} ▾
            </button>
            {menu === 'role' && (
              <div className="menu" role="menu">
                <b style={{ padding: '4px 8px', display: 'block' }}>Switch role (demo)</b>
                {ROLES.map(([r, n, l]) => <button key={r} className="menuitem" role="menuitem" onClick={() => switchTo(r)} disabled={r === user.role}>{n} · {l}{r === user.role ? ' (current)' : ''}</button>)}
              </div>)}
          </div>
        </>)}
    </header>
  );
}
