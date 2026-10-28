// The theme toggle: system, light, dark; it overrides the system setting, is remembered, never flashes, and stays accessible.
// Usage: WEB=http://127.0.0.1:3000 node e2e/theme.mjs   (stack must be running)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const WEB = process.env.WEB || 'http://127.0.0.1:3000';
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const open = async (scheme) => { const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme }); const p = await c.newPage(); p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => ['error', 'warning'].includes(m.type()) && /hydrat|did not match|Extra attributes/i.test(m.text()) && errors.push(m.text().slice(0, 140))); return p; };
const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const theme = (p) => p.evaluate(() => document.documentElement.getAttribute('data-theme'));
const saved = (p) => p.evaluate(() => localStorage.getItem('verity_theme'));
const toggle = (p) => p.getByRole('button', { name: /^Theme:/ });
const label = async (p) => (await toggle(p).getAttribute('aria-label'));
const LIGHT = 'rgb(250, 250, 250)', DARK = 'rgb(17, 17, 17)';
const serious = async (p) => { await p.waitForTimeout(800);   // let colour transitions finish: axe would otherwise measure a half-faded colour
  await p.addScriptTag({ content: AXE }); const r = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })); return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)); };

// ---- A light system: the site is still dark by default ----
let p = await open('light');
await p.goto(WEB + '/', { waitUntil: 'domcontentloaded' });
check('a new visitor gets the dark theme even on a light system, before the page is drawn', (await theme(p)) === 'dark');
await toggle(p).waitFor();
check('the toggle is in the header before anyone signs in', (await p.locator('header.topbar').getByRole('button', { name: /^Theme:/ }).count()) === 1);
check('by default: dark, nothing saved yet, and the label says so', (await bg(p)) === DARK && (await saved(p)) === null && /^Theme: Dark\. Switch to Light/.test(await label(p)));
check('the whole page is dark, not just the background (walkthrough bar and text), and the browser controls follow', await p.evaluate(() => { const bar = getComputedStyle(document.querySelector('nav[aria-label="Judge walkthrough"]')).backgroundColor; return bar === 'rgb(27, 27, 27)' && getComputedStyle(document.body).color === 'rgb(238, 238, 238)' && getComputedStyle(document.documentElement).colorScheme === 'dark'; }));
check('the landing page passes the accessibility audit in dark', (await serious(p)).length === 0);

await toggle(p).click();
check('first click: Light', (await theme(p)) === 'light' && (await bg(p)) === LIGHT && /^Theme: Light\./.test(await label(p)) && (await saved(p)) === 'light');
await p.reload({ waitUntil: 'domcontentloaded' });
check('Light survives a reload and is on the page before it is drawn (no flash)', (await theme(p)) === 'light' && (await saved(p)) === 'light');
check('the landing page passes the accessibility audit in light', (await serious(p)).length === 0);
await toggle(p).click();
check('second click: System, which follows this light computer', (await theme(p)) === null && (await bg(p)) === LIGHT && /^Theme: System\./.test(await label(p)) && (await saved(p)) === 'system');
await p.reload({ waitUntil: 'domcontentloaded' });
check('System survives a reload (it does not fall back to dark)', (await theme(p)) === null && (await saved(p)) === 'system');
await p.getByRole('button', { name: /^Theme: System\./ }).waitFor();   // the button learns the saved choice just after the page hydrates
await toggle(p).click();
check('third click: back to Dark', (await theme(p)) === 'dark' && (await bg(p)) === DARK && (await saved(p)) === 'dark');

// signed in, on other pages
await p.goto(WEB + '/'); await p.getByRole('button', { name: /Rajan · Manager/ }).click(); await p.waitForURL('**/queue'); await p.waitForSelector('tbody tr');
check('the choice carries into the signed-in pages', (await theme(p)) === 'dark' && (await bg(p)) === DARK);
check('queue and dashboard pass the accessibility audit in dark', (await serious(p)).length === 0 && (await (async () => { await p.goto(WEB + '/dashboard'); await p.waitForSelector('text=Compliance dashboard'); return serious(p); })()).length === 0);
await toggle(p).click();
check('Light carries into the signed-in pages too', (await theme(p)) === 'light' && (await bg(p)) === LIGHT);
check('the dashboard passes the accessibility audit in light', (await serious(p)).length === 0);

// keyboard
await toggle(p).focus(); await p.keyboard.press('Enter');
check('the toggle works from the keyboard', (await theme(p)) === null);
await p.close();

// ---- A dark system ----
p = await open('dark');
await p.goto(WEB + '/'); await toggle(p).waitFor();
check('on a dark system the default is dark', (await bg(p)) === DARK && (await theme(p)) === 'dark');
await toggle(p).click();
check('Light overrides a dark system', (await theme(p)) === 'light' && (await bg(p)) === LIGHT);
await toggle(p).click();
check('System follows the dark system', (await theme(p)) === null && (await bg(p)) === DARK);
await p.close();

check('no hydration warnings or page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll theme checks passed');
process.exit(failed ? 1 : 0);
