// Multi-brand workspaces in a real browser: one person, two brands, different roles, separate data, a contamination
// finding, and a read-only client report that works without signing in and stops working when revoked.
// Usage: WEB=http://127.0.0.1:3000 node e2e/multibrand.mjs   (stack must be running; creates a Northwind review and report link)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const WEB = process.env.WEB || 'http://127.0.0.1:3000';
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const watch = (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/404|favicon|Failed to load resource/.test(m.text()) && errors.push(m.text())); };

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB }).catch(() => {});
const p = await ctx.newPage(); watch(p);

// ---- Maya: a creator at Lumina ----
await p.goto(WEB + '/');
await p.getByRole('button', { name: /Maya · Creator/ }).click();
await p.waitForURL('**/queue');
const header = p.locator('header.topbar');
check('Maya starts in Lumina as a creator', (await header.innerText()).includes('Lumina Coffee Co.') && (await header.locator('.badge.green').innerText()) === 'creator');
check('creators at Lumina have no Dashboard or Brand link', (await header.getByRole('link', { name: 'Dashboard' }).count()) === 0 && (await header.getByRole('link', { name: 'Brand' }).count()) === 0);
await p.waitForSelector('table tbody tr');
const luminaRows = await p.locator('table tbody tr').count();
check('the Lumina queue has Maya\'s seeded reviews', luminaRows > 3, `rows=${luminaRows}`);

// ---- Switch to Northwind: same person, now a manager ----
await header.getByRole('button', { name: /Brand:/ }).click();
check('the switcher lists both brands with her role in each', (await p.getByRole('menuitem', { name: /Lumina Coffee Co\. · creator/ }).count()) === 1 && (await p.getByRole('menuitem', { name: /Northwind Tea Co\. · manager/ }).count()) === 1);
await p.getByRole('menuitem', { name: /Northwind Tea Co\. · manager/ }).click();
await p.waitForURL('**/queue');
await p.getByRole('button', { name: /Brand:.*Northwind/ }).waitFor();
check('at Northwind Maya is a manager', (await header.locator('.badge.green').innerText()) === 'manager' && (await header.getByRole('link', { name: 'Dashboard' }).count()) === 1);
await p.waitForLoadState('networkidle');
const northwindRows = await p.locator('table tbody tr').count();
check('Lumina reviews are not visible at Northwind', northwindRows < luminaRows / 2 && (await p.getByText('Lumina spring campaign').count()) === 0, `rows=${northwindRows}`);

// ---- A Northwind review that contains Lumina's wording ----
await p.goto(WEB + '/review');
await p.getByText('Load sample content').click();
await p.getByRole('button', { name: 'Run Verity review' }).click();
await p.getByText(/ToneGuard · \d/).waitFor({ timeout: 30000 });
await p.waitForSelector('.flag', { timeout: 30000 });
const badges = await p.locator('.item .badge').allInnerTexts();
check('the review is checked against Northwind guidelines (tea terms flagged)', (await p.locator('.flag').count()) >= 4, `flags=${await p.locator('.flag').count()}`);
check('Lumina wording in Northwind content is flagged as "other brand"', badges.includes('other brand'), badges.join(','));
const tab = (await p.title());
check('the page title is set', /Verity/.test(tab));

// ---- Dashboard: create a client report link ----
await p.goto(WEB + '/dashboard');
await p.getByRole('button', { name: 'Create link' }).waitFor();
await p.getByLabel('Label').fill('Acme monthly');
await p.getByRole('button', { name: 'Create link' }).click();
const linkBox = p.getByLabel('Report link');
await linkBox.waitFor();
const url = await linkBox.inputValue();
check('a report link is shown once', /\/report\?token=[\w-]{30,}/.test(url));
check('the share card passes the accessibility audit', await (async () => {
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(() => axe.run(document.querySelector('[aria-labelledby="share-h"]'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).length === 0;
})());

// ---- The client: no session at all ----
const client = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage(); watch(client);
await client.goto(url);
await client.getByRole('heading', { name: /Compliance report: Northwind Tea Co\./ }).waitFor();
const text = await client.locator('body').innerText();
check('the client sees the Northwind report without signing in', /Northwind Tea Co\./.test(text) && /Recent reviews/.test(text));
check('the report shows no team member names and no review text', !/Maya|Rajan|Anita/.test(text) && !/tea bags|cuppa/.test(text));
check('no judge walkthrough bar and no navigation on the client report', (await client.getByRole('navigation', { name: 'Judge walkthrough' }).count()) === 0);
await client.addScriptTag({ content: AXE });
const ax = await client.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
check('the client report passes the accessibility audit', ax.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).length === 0, ax.violations.map((v) => v.id).join(','));
await client.setViewportSize({ width: 320, height: 700 });
check('the client report fits a 320 px screen', !(await client.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));

// ---- Revoke: the same link stops working ----
await p.getByRole('button', { name: /Revoke link Acme monthly/ }).click();
await p.getByText('revoked').first().waitFor();
await client.reload();
await client.locator('main [role=alert]').waitFor();
check('after revoking, the link says it is not valid', /not valid/.test(await client.locator('main [role=alert]').innerText()));
check('a made-up token says the same', await (async () => { await client.goto(WEB + '/report?token=made-up-token'); await client.locator('main [role=alert]').waitFor(); return /not valid/.test(await client.locator('main [role=alert]').innerText()); })());

// ---- Back to Lumina: roles and data follow the brand ----
await header.getByRole('button', { name: /Brand:/ }).click();
await p.getByRole('menuitem', { name: /Lumina Coffee Co\. · creator/ }).click();
await p.getByRole('button', { name: /Brand:.*Lumina/ }).waitFor();
check('back at Lumina Maya is a creator again', (await header.locator('.badge.green').innerText()) === 'creator' && (await header.getByRole('link', { name: 'Dashboard' }).count()) === 0);
await p.goto(WEB + '/dashboard');
check('the dashboard is closed to her at Lumina', (await p.getByText('The dashboard is for managers and approvers').count()) === 1);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll multi-brand checks passed');
process.exit(failed ? 1 : 0);
