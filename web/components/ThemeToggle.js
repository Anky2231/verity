'use client';
import { useEffect, useState } from 'react';

// Dark by default, or light, or follow the system. The choice is kept in this browser and applied as data-theme on <html>
// ("system" removes the attribute, so the stylesheet's prefers-color-scheme rules decide). With no saved choice the site is dark.
const ORDER = ['dark', 'light', 'system'];
const LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON = { system: '◐', light: '☀', dark: '☾' };
const DEFAULT = 'dark';
const KEY = 'verity_theme';

const read = () => { try { const t = localStorage.getItem(KEY); return ORDER.includes(t) ? t : DEFAULT; } catch { return DEFAULT; } };
function apply(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(DEFAULT);
  useEffect(() => { setTheme(read()); }, []);

  function next() {
    const t = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(t); apply(t);
    try { localStorage.setItem(KEY, t); } catch { /* private mode: the choice lasts for this page only */ }
  }

  const to = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button className="iconbtn" onClick={next} aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[to]}`} title={`Theme: ${LABEL[theme]} (click for ${LABEL[to]})`}>
      <span aria-hidden="true">{ICON[theme]}</span>
    </button>
  );
}
