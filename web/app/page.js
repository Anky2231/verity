'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { loginAs } from '../lib/session';

const ROLES = [
  { role: 'creator', label: 'Creator', name: 'Maya', desc: 'Write content, fix flags, submit.' },
  { role: 'manager', label: 'Manager', name: 'Rajan', desc: 'Upload guidelines, approve or reject.' },
  { role: 'approver', label: 'Approver', name: 'Anita', desc: 'Final sign-off on escalations.' },
];

export default function Home() {
  const router = useRouter();
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api('/health/deep').then(setHealth).catch(() => setHealth({ api: 'down', ai: 'unknown' })); }, []);

  async function enter(role, to = '/queue') {
    setError('');
    try { await loginAs(role); router.push(to); } catch { setError('Could not sign in. The service may be waking up; please try again in a few seconds.'); }
  }

  return (
    <div style={{ maxWidth: 680, margin: '56px auto', padding: '0 16px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 38, marginBottom: 4 }}>Verity</h1>
      <p className="muted" style={{ marginTop: 0, fontSize: 16 }}>Every word. Every pixel. On brand.</p>
      <p style={{ maxWidth: 480, margin: '16px auto', lineHeight: 1.6 }}>
        AI agents check content against your brand guidelines and explain every flag. People make the final call, and every decision is recorded.
      </p>
      <button className="primary" style={{ padding: '12px 22px', fontSize: 16 }} onClick={() => enter('manager', '/brand')}>Start judge walkthrough</button>
      <p className="muted" style={{ marginTop: 8 }}>No signup. Five guided steps, about five minutes.</p>

      <div className="card" style={{ textAlign: 'left', marginTop: 28 }}>
        <b>Or explore as a role</b>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {ROLES.map((r) => (
            <button key={r.role} onClick={() => enter(r.role)} style={{ flex: '1 1 170px', textAlign: 'left', padding: 12 }}>
              <div style={{ fontWeight: 600 }}>{r.name} · {r.label}</div>
              <div className="muted" style={{ fontSize: 13 }}>{r.desc}</div>
            </button>))}
        </div>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}

      <p style={{ marginTop: 28 }}><a href="/about">What changed since Round 1</a> · <a href="/roadmap">Round 3 roadmap</a></p>
      <p className="muted">
        API {health ? <span className={`badge ${health.api === 'up' ? 'green' : 'red'}`}>{health.api}</span> : '…'}
        {' '}AI service {health ? <span className={`badge ${health.ai === 'up' ? 'green' : 'red'}`}>{health.ai}</span> : '…'}
      </p>
    </div>
  );
}
