// The landing hero (3D corridor of cards) and that the sign-in controls inside it still work.
// Usage: WEB=http://127.0.0.1:3000 node e2e/landing.mjs   (stack must be running)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const WEB = process.env.WEB || 'http://127.0.0.1:3000';
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const open = async (opts) => { const c = await browser.newContext(opts); const p = await c.newPage(); p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => ['error', 'warning'].includes(m.type()) && /hydrat|did not match|Expected server HTML/i.test(m.text()) && errors.push(m.text().slice(0, 160))); return p; };
const serious = async (p) => { await p.addScriptTag({ content: AXE }); const r = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })); return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)); };

// ---- Desktop: the corridor ----
let p = await open({ viewport: { width: 1360, height: 860 } });
await p.goto(WEB + '/'); await p.getByRole('heading', { level: 1 }).waitFor();
check('the headline is the page\'s one h1', (await p.getByRole('heading', { level: 1 }).count()) === 1 && /Every word\.\s*Every pixel\.\s*On brand\./.test(await p.getByRole('heading', { level: 1 }).innerText()));
check('the sign-in controls are all still there', (await p.getByRole('button', { name: 'Start judge walkthrough' }).count()) === 1 && (await p.getByRole('button', { name: /Maya · Creator/ }).count()) === 1 && (await p.getByRole('button', { name: /Rajan · Manager/ }).count()) === 1 && (await p.getByRole('button', { name: /Anita · Approver/ }).count()) === 1);
check('the API and AI service status is still shown', /API\s+up/.test(await p.locator('body').innerText()));
await p.waitForTimeout(5000);
const cards = await p.locator('section > div[aria-hidden=true].inset-0 > div').count();
check('the 3D corridor has one card for each thing Verity checks', cards === 9, `cards=${cards}`);
check('the cards are hidden from screen readers and a plain list stands in for them', (await p.locator('section ul.sr-only li').count()) === 9);
check('the cards do not block clicks on the sign-in button', await p.getByRole('button', { name: 'Start judge walkthrough' }).evaluate((b) => { const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b.contains(top); }));
check('the landing page passes the accessibility audit', (await serious(p)).length === 0);

// the wheel flies the corridor, and at the end it hands the page back
const y0 = await p.evaluate(() => scrollY);
await p.mouse.move(680, 400);
await p.mouse.wheel(0, 400); await p.waitForTimeout(800);        // one turn of the wheel moves the corridor part of the way
const y1 = await p.evaluate(() => scrollY);
for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(60); }   // many more reach the end, then the page scrolls
await p.waitForTimeout(500);
const y2 = await p.evaluate(() => scrollY);
check('while the corridor can still move, the wheel flies it and the page stays put', y0 === 0 && y1 === 0, `scrollY ${y0} then ${y1}`);
check('once the corridor has reached its end, the wheel scrolls the page', y2 > 0, `scrollY ${y2}`);
check('the role cards below the hero are reachable', await p.getByRole('button', { name: /Maya · Creator/ }).evaluate((b) => b.getBoundingClientRect().top < innerHeight + 4000));
await p.close();

// ---- Sign-in still works from inside the hero ----
p = await open({ viewport: { width: 1360, height: 860 } });
await p.goto(WEB + '/'); await p.getByRole('button', { name: 'Start judge walkthrough' }).click();
await p.waitForURL('**/brand', { timeout: 30000 });
check('Start judge walkthrough still signs in as the manager and opens Brand', true);
await p.close();

// ---- Narrow screen and reduced motion: no 3D, same cards as a grid ----
for (const [name, opts] of [['a phone-width window', { viewport: { width: 390, height: 800 } }], ['reduced motion', { viewport: { width: 1360, height: 860 }, reducedMotion: 'reduce' }]]) {
  p = await open(opts);
  await p.goto(WEB + '/'); await p.getByRole('heading', { level: 1 }).waitFor(); await p.waitForTimeout(800);
  check(`${name}: the cards are a plain grid of 9, with no 3D corridor`, (await p.locator('section ul.grid > li').count()) === 9 && (await p.locator('section > div[aria-hidden=true].inset-0 > div').count()) === 0);
  check(`${name}: no horizontal scrolling`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  check(`${name}: passes the accessibility audit`, (await serious(p)).length === 0);
  await p.close();
}

check('no hydration warnings or page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll landing checks passed');
process.exit(failed ? 1 : 0);
