'use client';
import { useEffect, useState } from 'react';

// Judge walkthrough progress, kept in the browser so the steps tick themselves.
const KEY = 'verity_progress';
export const readProgress = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

export function markProgress(step, extra = {}) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readProgress(), [step]: true, ...extra })); } catch { /* ignore */ }
  window.dispatchEvent(new Event('verity:progress'));
}

export function useProgress() {
  const [p, setP] = useState({});
  useEffect(() => {
    const sync = () => setP(readProgress());
    sync();
    window.addEventListener('verity:progress', sync);
    return () => window.removeEventListener('verity:progress', sync);
  }, []);
  return p;
}
