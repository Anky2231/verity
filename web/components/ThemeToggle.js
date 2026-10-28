'use client';
import { useEffect, useState } from 'react';

// Light, dark, or follow the system. The choice is kept in this browser and applied as data-theme on <html>;
// "system" removes the attribute, so the stylesheet's prefers-color-scheme rules decide.
const ORDER = ['system', 'light', 'dark'];
const LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON = { system: '◐', light: '☀', dark: '☾' };
const KEY = 'verity_theme';

const read = () => { try { const t = localStorage.getItem(KEY); return ORDER.includes(t) ? t : 'system'; } catch { return 'system'; } };
function apply(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState('system');
  useEffect(() => { setTheme(read()); }, []);

  function next() {
    const t = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(t); apply(t);
    try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private mode: the choice lasts for this page only */ }
  }

  const to = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button className="iconbtn" onClick={next} aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[to]}`} title={`Theme: ${LABEL[theme]} (click for ${LABEL[to]})`}>
      <span aria-hidden="true">{ICON[theme]}</span>
    </button>
  );
}
