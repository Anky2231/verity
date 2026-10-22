'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { loginAs, parseJwt } from '../lib/session';
import { markProgress, useProgress } from '../lib/progress';

// One-click guided tour for judges. Each step signs in as the right role, opens the right page, and ticks itself when done.
const STEPS = [
  { key: 'guideline', role: 'manager', href: () => '/brand', title: 'Upload sample guideline', text: 'As Rajan, use the sample guideline, review what was extracted, then publish it.' },
  { key: 'review', role: 'creator', href: () => '/review', title: 'Review sample content', text: 'As Maya, load the sample content and run the AI review.' },
  { key: 'fix', role: 'creator', href: (p) => (p.lastReview ? `/review?id=${p.lastReview}` : '/review'), title: 'Fix flags', text: 'Accept a fix or dispute a flag, re-run, then submit for approval.' },
  { key: 'approve', role: 'manager', href: () => '/queue', title: 'Approve as Manager', text: 'Filter to "submitted" and approve, escalate or reject with a reason.' },
  { key: 'insight', role: 'manager', href: () => '/dashboard', title: 'See audit and analytics', text: 'Open the dashboard and the audit trail; verify the hash chain.' },
];

export default function Walkthrough() {
  const router = useRouter();
  const path = usePathname();
  const p = useProgress();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState(null);

  useEffect(() => {
    try { setOpen(localStorage.getItem('verity_tour') !== 'closed'); setRole(parseJwt(localStorage.getItem('verity_token') || '')?.role ?? null); } catch { /* ignore */ }
    if (path === '/audit' || path === '/dashboard') markProgress('insight');
  }, [path]);
  const toggle = (v) => { setOpen(v); try { localStorage.setItem('verity_tour', v ? 'open' : 'closed'); } catch { /* ignore */ } };

  async function go(step) {
    setBusy(true);
    try {
      if (parseJwt(localStorage.getItem('verity_token') || '')?.role !== step.role) await loginAs(step.role);
      router.push(step.href(p));
    } catch { router.push('/'); } finally { setBusy(false); }
  }

  const done = STEPS.filter((s) => p[s.key]).length;
  const next = STEPS.findIndex((s) => !p[s.key]);
  const bar = { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: 'var(--card)', borderTop: '1px solid var(--line)', boxShadow: '0 -2px 8px rgba(0,0,0,.08)' };
  return (
    <>
      <div style={{ height: open ? 172 : 48 }} aria-hidden />
      <nav aria-label="Judge walkthrough" style={bar}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '8px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 14 }}>Judge walkthrough <span className="muted">· {done}/{STEPS.length} done{role ? ` · signed in as ${role}` : ''}</span></b>
            <button onClick={() => toggle(!open)} aria-expanded={open} style={{ padding: '4px 10px', fontSize: 13 }}>{open ? 'Hide' : 'Show steps'}</button>
          </div>
          {open && (
            <ol style={{ display: 'flex', gap: 8, margin: '8px 0 0', padding: 0, listStyle: 'none', overflowX: 'auto' }}>
              {STEPS.map((s, i) => (
                <li key={s.key} style={{ flex: '1 0 200px' }}>
                  <button onClick={() => go(s)} disabled={busy} style={{ width: '100%', textAlign: 'left', padding: 8, height: '100%',
                    borderColor: i === next ? 'var(--accent)' : undefined, borderWidth: i === next ? 2 : 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      <span aria-label={p[s.key] ? 'done' : 'not done'}>{p[s.key] ? '✅' : `${i + 1}.`}</span> {s.title} <span className="badge">{s.role}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{s.text}</div>
                  </button>
                </li>))}
            </ol>)}
        </div>
      </nav>
    </>
  );
}
