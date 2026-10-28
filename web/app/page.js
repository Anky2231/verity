'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API } from '../lib/api';
import { loginAs } from '../lib/session';
import { SLOW_MS, pollUntilUp } from '../lib/wake';
import PerspectiveTunnelHero from '../components/ui/perspective-tunnel-hero';
import { LANDING_ITEMS } from '../lib/landing-items';

const ROLES = [
  { role: 'creator', label: 'Creator', name: 'Maya', desc: 'Write content, fix flags, submit.' },
  { role: 'manager', label: 'Manager', name: 'Rajan', desc: 'Upload guidelines, approve or reject.' },
  { role: 'approver', label: 'Approver', name: 'Anita', desc: 'Final sign-off on escalations.' },
];
const NOT_ANSWERING = 'The server is not answering. It may still be starting; please try again in a minute.';

// One health check that never throws: the health payload, or null if the server did not answer in time.
async function ping() {
  try {
    const res = await fetch(`${API}/health/deep`, { signal: AbortSignal.timeout(10000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export default function Home() {
  const router = useRouter();
  const [health, setHealth] = useState(null);
  const [waking, setWaking] = useState(false);   // the server is slow to answer: probably waking from sleep
  const [seconds, setSeconds] = useState(0);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const started = Date.now();
    const slow = setTimeout(() => alive && setWaking(true), SLOW_MS);
    const clock = setInterval(() => alive && setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    pollUntilUp({ ping }).then((h) => {
      if (!alive) return;
      clearTimeout(slow); clearInterval(clock);
      setWaking(false);
      setHealth(h ?? { api: 'down', ai: 'unknown' });
      if (!h) setError(NOT_ANSWERING);
    });
    return () => { alive = false; clearTimeout(slow); clearInterval(clock); };
  }, []);

  async function enter(role, to = '/queue') {
    setError('');
    setSigningIn(true);
    try {
      // If the server is still waking up, wait for it instead of failing: the sign-in continues by itself.
      if (!health || health.api !== 'up') {
        const h = await pollUntilUp({ ping });
        if (!h) { setError(NOT_ANSWERING); return; }
        setHealth(h); setWaking(false);
      }
      await loginAs(role);
      router.push(to);
    } catch { setError('Could not sign in. Please try again in a few seconds.'); }
    finally { setSigningIn(false); }
  }

  return (
    <>
      <PerspectiveTunnelHero
        items={LANDING_ITEMS}
        eyebrow="Verity · Brand governance"
        title={<>Every word.<br />Every pixel.<br />On brand.</>}
        description="AI agents check content against your brand guidelines and explain every flag. People make the final call, and every decision is recorded."
        scrollHint="Scroll to see what Verity checks"
      >
        {waking && (
          <div role="status" className="card" style={{ textAlign: 'left', borderColor: 'var(--accent)' }}>
            <b>Waking up the server…</b>
            <p className="muted" style={{ margin: '6px 0' }}>
              This demo runs on free hosting that goes to sleep when nobody is using it, so the first visit can take up to a minute.
              You do not need to do anything: you can pick a role below and sign-in will continue as soon as the server is ready.
              <span aria-hidden="true"> ({seconds}s)</span>
            </p>
            <div className="bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (seconds / 60) * 100)}%` }} /></div>
          </div>)}

        <button className="primary" style={{ padding: '12px 22px', fontSize: 16 }} disabled={signingIn} onClick={() => enter('manager', '/brand')}>
          {signingIn ? (waking ? 'Waiting for the server…' : 'Signing in…') : 'Start judge walkthrough'}
        </button>
        <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>No signup. Five guided steps, about five minutes.</p>
        {error && (
          <div className="toast" role="alert" style={{ justifyContent: 'center', gap: 12 }}>
            <span>{error}</span><button onClick={() => window.location.reload()}>Try again</button>
          </div>)}
      </PerspectiveTunnelHero>

      <div style={{ maxWidth: 680, margin: '32px auto 56px', padding: '0 16px', textAlign: 'center' }}>
        <div className="card" style={{ textAlign: 'left' }}>
          <b>Or explore as a role</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {ROLES.map((r) => (
              <button key={r.role} disabled={signingIn} onClick={() => enter(r.role)} style={{ flex: '1 1 170px', textAlign: 'left', padding: 12 }}>
                <div style={{ fontWeight: 600 }}>{r.name} · {r.label}</div>
                <div className="muted" style={{ fontSize: 13 }}>{r.desc}</div>
              </button>))}
          </div>
        </div>

        <p style={{ marginTop: 28 }}><a href="/about">What changed since Round 1</a> · <a href="/roadmap">Round 3 results</a></p>
        <p className="muted">
          API {health ? <span className={`badge ${health.api === 'up' ? 'green' : 'red'}`}>{health.api}</span> : '…'}
          {' '}AI service {health ? <span className={`badge ${health.ai === 'up' ? 'green' : 'red'}`}>{health.ai}</span> : '…'}
        </p>
      </div>
    </>
  );
}
