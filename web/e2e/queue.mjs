// The review queue at realistic size: 25 at a time, load more, title search, filters together, and accessibility.
// Usage: WEB=http://127.0.0.1:3000 node e2e/queue.mjs   (stack must be running with the seeded history)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const WEB = process.env.WEB || 'http://127.0.0.1:3000';
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage();
p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/404|favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
const rows = () => p.locator('tbody tr').count();
const shown = async () => Number(/Showing (\d+)/.exec(await p.getByRole('status').filter({ hasText: 'Showing' }).innerText())[1]);

await p.goto(WEB + '/'); await p.getByRole('button', { name: /Rajan · Manager/ }).click(); await p.waitForURL('**/queue');
await p.waitForSelector('tbody tr');
check('the queue shows 25 reviews first, and says more are available', (await rows()) === 25 && /more available/.test(await p.getByRole('status').filter({ hasText: 'Showing' }).innerText()));
await p.getByRole('button', { name: 'Load more' }).click();
await p.waitForFunction(() => document.querySelectorAll('tbody tr').length === 50);
check('Load more adds the next 25 without repeating any', (await rows()) === 50 && new Set(await p.locator('tbody tr td:first-child a').evaluateAll((a) => a.map((x) => x.getAttribute('href')))).size === 50);

await p.getByLabel('Search titles').fill('newsletter');
await p.waitForFunction(() => [...document.querySelectorAll('tbody tr td:first-child')].every((td) => /newsletter/i.test(td.textContent)) && document.querySelectorAll('tbody tr').length > 0);
const hits = await p.locator('tbody tr td:first-child').allInnerTexts();
check('searching shows only titles that contain the text', hits.length > 0 && hits.every((t) => /newsletter/i.test(t)), `${hits.length} hits`);
await p.locator('select[aria-label="Status filter"]').selectOption('published');
await p.waitForTimeout(600); await p.waitForLoadState('networkidle');
const both = await p.locator('tbody tr').evaluateAll((r) => r.map((x) => [x.cells[0].textContent, x.cells[2].textContent]));
check('search and status filter work together', both.every(([t, s]) => /newsletter/i.test(t) && /Published/.test(s)), `${both.length} rows`);
await p.getByLabel('Search titles').fill('zzz no such title');
await p.getByText(/Nothing matches/).waitFor();
check('a search with no match says so', true);
await p.getByLabel('Search titles').fill('50% off_');   // % and _ are plain characters
await p.getByText(/Nothing matches/).waitFor();
check('special characters in the search are plain text', true);
await p.getByLabel('Search titles').fill(''); await p.locator('select[aria-label="Status filter"]').selectOption('');
await p.waitForFunction(() => document.querySelectorAll('tbody tr').length === 25);
check('clearing the search and filter returns to the first 25', true);

await p.addScriptTag({ content: AXE });
const ax = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
check('the queue passes the accessibility audit', ax.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).length === 0, ax.violations.map((v) => v.id).join(','));
await p.setViewportSize({ width: 320, height: 700 });
check('the queue fits a 320 px screen', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll queue checks passed');
process.exit(failed ? 1 : 0);
