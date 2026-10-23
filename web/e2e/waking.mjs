// Simulates a sleeping server (slow or failing health checks) and checks that the landing page explains it, keeps trying,
// lets a visitor sign in once the server is ready, and that the "waking up" message itself passes the accessibility audit.
// Usage: WEB=http://127.0.0.1:3000 node e2e/waking.mjs   (stack must be running)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const WEB = process.env.WEB || 'http://127.0.0.1:3000';
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const UP = { status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, api: 'up', ai: 'up' }) };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scenario(name, handler, body) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  let calls = 0;
  const start = Date.now();                                   // a sleeping server delays EVERY call until it is awake
  await p.route('**/health/deep', (route) => handler(route, ++calls, Date.now() - start));
  await p.goto(WEB + '/');
  await body(p, () => calls);
  check(`${name}: no page errors`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// A. A slow server (answers after 5 s): the message appears, passes axe, then disappears and the badges turn to "up".
await scenario('slow server', async (route, n, t) => { if (t < 5000) await sleep(5000 - t); await route.fulfill(UP); }, async (p) => {
  const banner = p.getByRole('status').filter({ hasText: 'Waking up the server' });
  await banner.waitFor({ timeout: 6000 });
  check('slow server: the waking-up message appears', true);
  await p.addScriptTag({ content: AXE });
  const res = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id);
  check('slow server: the message has no serious accessibility violations', bad.length === 0, bad.join(', '));
  check('slow server: the seconds counter is hidden from screen readers', (await banner.locator('[aria-hidden="true"]').count()) >= 1);
  await banner.waitFor({ state: 'hidden', timeout: 15000 });
  await p.locator('.badge.green').first().waitFor({ timeout: 5000 });
  check('slow server: the message goes away and the badges show up', (await p.locator('.badge.green').count()) === 2);
});

// B. A flaky server (checks fail for the first 5 seconds): the page keeps trying and recovers on its own.
await scenario('flaky server', async (route, n, t) => { if (t < 5000) await route.abort('failed'); else await route.fulfill(UP); }, async (p, calls) => {
  await p.getByRole('status').filter({ hasText: 'Waking up the server' }).waitFor({ timeout: 8000 });
  await p.locator('.badge.green').first().waitFor({ timeout: 20000 });
  check('flaky server: recovers by itself after failed checks', calls() >= 3 && (await p.locator('.badge.green').count()) === 2, `checks=${calls()}`);
});

// C. A visitor clicks a role while the server is still waking: sign-in waits and then continues by itself.
await scenario('click during wake-up', async (route, n, t) => { if (t < 8000) await sleep(8000 - t); await route.fulfill(UP); }, async (p) => {
  await p.getByRole('status').filter({ hasText: 'Waking up the server' }).waitFor({ timeout: 6000 });
  await p.getByRole('button', { name: /Maya/ }).first().click();
  check('click during wake-up: buttons are disabled while signing in', await p.getByRole('button', { name: 'Waiting for the server…' }).isVisible());
  await p.waitForURL('**/queue', { timeout: 20000 });
  check('click during wake-up: signs in and reaches the queue without a second click', true);
});

// D. A healthy server: no message at all (it must not flash on every normal visit).
await scenario('healthy server', async (route) => { await route.fulfill(UP); }, async (p) => {
  await p.locator('.badge.green').first().waitFor({ timeout: 5000 });
  await sleep(3000);
  check('healthy server: the waking-up message never appears', (await p.getByText('Waking up the server').count()) === 0);
});

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll wake-up checks passed');
process.exit(failed ? 1 : 0);
