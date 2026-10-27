// Brand Drift Intelligence in a real browser, on the seeded history (Social drifts, Email and Blog are steady).
// Usage: WEB=http://127.0.0.1:3000 node e2e/drift.mjs   (stack must be running; the once-a-week digest rule is covered by the API tests)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const WEB = process.env.WEB || 'http://127.0.0.1:3000';
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const open = async (scheme = 'light', width = 1280) => {
  const c = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme }); const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/404|favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return p;
};
const login = async (p, label) => { await p.goto(WEB + '/'); await p.getByRole('button', { name: label }).click(); await p.waitForURL('**/queue'); };
const serious = async (p) => { await p.addScriptTag({ content: AXE }); const r = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })); return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)); };

// ---- Manager ----
let p = await open();
await login(p, /Rajan · Manager/);
await p.getByRole('link', { name: 'Drift' }).click();
await p.waitForURL('**/drift');
await p.getByRole('heading', { name: /Brand drift: Lumina Coffee Co\./ }).waitFor();
await p.getByRole('heading', { name: 'Teams', exact: true }).waitFor();
const rows = await p.locator('section ~ div table tbody tr, .card table tbody tr').allInnerTexts();
const teamRow = (name) => rows.find((r) => r.startsWith(name)) ?? '';
check('Social is reported as drifting', /Drifting/.test(teamRow('Social')), teamRow('Social').replace(/\s+/g, ' '));
check('Email, Blog and Content are not', ['Email', 'Blog', 'Content'].every((t) => /Stable/.test(teamRow(t))), rows.map((r) => r.split('\t')[0] + ':' + (/Stable/.test(r) ? 'stable' : /Drifting/.test(r) ? 'drifting' : 'other')).join(' '));
check('the drifting team is listed first', rows[0].startsWith('Social'));
const digest = await p.getByRole('region', { name: /digest/i }).innerText().catch(async () => await p.locator('#digest-h').locator('..').innerText());
check('the weekly digest names Social and the likely next clause', /Social is drifting/.test(digest) && /Voice §1\.2/.test(digest));
check('the likely-next list names Voice §1.2', (await p.getByText('Most likely to be broken next').count()) === 1 && (await p.getByText(/Voice §1\.2:/).count()) >= 1);
check('every team has a chart with a text description', (await p.locator('svg[role=img]').count()) >= 4 && (await p.locator('svg[role=img]').first().getAttribute('aria-label')).includes('violations per 100 words by week'));
await p.getByText('View the same data as a table').first().click();
check('the chart data is also available as a table', (await p.locator('details[open] table tbody tr').count()) >= 9);
check('the drift page passes the accessibility audit in light mode', (await serious(p)).length === 0);
await p.setViewportSize({ width: 320, height: 700 });
check('the drift page fits a 320 px screen', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));

// ---- The alert reached the manager once, and reopening does not repeat it ----
await p.setViewportSize({ width: 1280, height: 900 });
await p.reload(); await p.getByRole('heading', { name: 'Teams', exact: true }).waitFor();
const digest2 = await p.locator('#digest-h').locator('..').innerText();
check('opening the page again does not call the digest new', !/\bnew\b/.test(digest2.split('\n')[0]), digest2.split('\n')[0]);
const bell = async () => { await p.getByRole('button', { name: /Notifications/ }).click(); const n = await p.locator('[role=menu] a', { hasText: 'Drift alert' }).count(); await p.keyboard.press('Escape'); await p.mouse.click(5, 300); return n; };
const before = await bell();
check('the manager has a drift alert for the Social team', before >= 1, `alerts=${before}`);
await p.reload(); await p.getByRole('heading', { name: 'Teams', exact: true }).waitFor(); await p.reload(); await p.getByRole('heading', { name: 'Teams', exact: true }).waitFor();
check('opening the page again does not send more alerts', (await bell()) === before);
await p.close();

// ---- Dark mode ----
p = await open('dark'); await login(p, /Rajan · Manager/); await p.goto(WEB + '/drift'); await p.getByRole('heading', { name: 'Teams', exact: true }).waitFor();
check('the drift page passes the accessibility audit in dark mode', (await serious(p)).length === 0);
await p.close();

// ---- Creator and brand rules ----
p = await open(); await login(p, /Maya · Creator/);
check('creators have no Drift link', (await p.getByRole('link', { name: 'Drift' }).count()) === 0);
await p.goto(WEB + '/drift');
check('creators who open /drift are told it is not for them', (await p.getByText('Brand drift is for managers and approvers').count()) === 1);
await p.getByRole('button', { name: /Brand:/ }).click();
await p.getByRole('menuitem', { name: /Northwind Tea Co\. · manager/ }).click();
await p.getByRole('button', { name: /Brand:.*Northwind/ }).waitFor();
await p.goto(WEB + '/drift');
await p.getByRole('heading', { name: /Brand drift: Northwind Tea Co\./ }).waitFor();
await p.waitForLoadState('networkidle');
const nw = await p.locator('body').innerText();
check('Northwind\'s drift page shows none of Lumina\'s teams', !/Social|Email|Content|Blog/.test(nw.replace(/Brand drift/, '')) && !/Drifting/.test(nw), nw.slice(0, 120).replace(/\n/g, ' '));
await p.close();

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll drift checks passed');
process.exit(failed ? 1 : 0);
