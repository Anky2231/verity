// Keyboard-only and reflow checks. Drives the creator journey using Tab / Shift+Tab / Enter / Escape and typed text only,
// then checks that no page needs horizontal scrolling at 320 px wide or at an effective 200% zoom (640 x 450).
// Usage: WEB=http://127.0.0.1:3000 node e2e/keyboard.mjs   (stack must be running)
import { chromium } from 'playwright-core';

const WEB = process.env.WEB || 'http://127.0.0.1:3000';
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const label = (p) => p.evaluate(() => { const e = document.activeElement; return ((e?.getAttribute('aria-label') || e?.innerText || e?.value || '').trim().split('\n')[0] || e?.tagName || ''); });

// Press Tab until the focused control's name contains `text` (never uses the mouse).
async function tabTo(p, text, max = 160) {
  for (let i = 0; i < max; i++) { await p.keyboard.press('Tab'); if ((await label(p)).includes(text)) return i + 1; }
  throw new Error(`could not reach "${text}" by keyboard within ${max} Tab presses`);
}

// ---- 1. Every interactive element can be reached by keyboard, on every page ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  const unreachable = async (name) => {
    const bad = await p.evaluate(() => [...document.querySelectorAll('a[href], button, input, select, textarea, [role=button], [role=link], [tabindex]')]
      .filter((e) => e.offsetParent !== null && !e.disabled && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.ProseMirror'))
      .filter((e) => e.tabIndex < 0 || (e.hasAttribute('tabindex') && Number(e.getAttribute('tabindex')) > 0))
      .map((e) => (e.getAttribute('aria-label') || e.innerText || e.tagName).slice(0, 40)));
    check(`tab order: ${name}`, bad.length === 0, bad.slice(0, 3).join(' | '));
  };
  await p.goto(WEB + '/'); await p.waitForTimeout(1500); await unreachable('/');
  await p.getByText('Maya · Creator').first().click(); await p.waitForURL('**/queue'); await p.waitForSelector('tbody tr'); await unreachable('/queue');
  for (const path of ['/about', '/roadmap']) { await p.goto(WEB + path); await unreachable(path); }
  await ctx.close();
}

// ---- 2. The creator journey with the keyboard only ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  await p.goto(WEB + '/'); await p.waitForTimeout(1500);
  await p.keyboard.press('Tab'); check('first Tab stop is the skip link', (await label(p)).includes('Skip to content'));
  await tabTo(p, 'Maya · Creator'); await p.keyboard.press('Enter'); await p.waitForURL('**/queue');
  check('signed in as the creator with Tab and Enter', true);
  await p.waitForSelector('tbody tr');
  await tabTo(p, '+ New review'); await p.keyboard.press('Enter'); await p.waitForURL('**/review');
  check('"+ New review" link works with Enter (one tab stop, not a button inside a link)', true);
  await tabTo(p, 'Load sample content'); await p.keyboard.press('Enter');
  await tabTo(p, 'Run Verity review'); await p.keyboard.press('Enter');
  await p.waitForSelector('.flag', { timeout: 60000 });
  check('review ran from the keyboard', (await p.locator('.flag').count()) >= 5);

  await tabTo(p, 'Next flag'); await p.keyboard.press('Enter');
  const expanded = () => p.locator('.item-head[aria-expanded="true"]').evaluateAll((els) => els.map((e) => e.innerText.split('\n').pop()));
  const before = await expanded(); await p.keyboard.press('Enter'); const after = await expanded();
  check('Next flag moves the selection to a different flag', before[0] !== after[0], `${before[0]} -> ${after[0]}`);

  await tabTo(p, 'Dispute'); await p.keyboard.press('Enter');
  await p.getByRole('dialog').waitFor();
  const focusedBox = await p.waitForFunction(() => document.activeElement?.id === 'reason-dialog-input', null, { timeout: 3000 }).then(() => true, () => false);
  check('dialog opened from the keyboard with focus in the text box', focusedBox);
  await p.keyboard.type('Our trade audience expects this wording.');
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); check('Tab reaches Continue inside the dialog', (await label(p)) === 'Continue');
  await p.keyboard.press('Enter'); await p.getByRole('dialog').waitFor({ state: 'hidden' });
  check('decision saved from the keyboard', (await p.getByText(/Decisions and reasons \(1\)/).count()) === 1);

  await tabTo(p, 'Submit for approval'); await p.keyboard.press('Enter');
  await p.getByText(/text is locked/).waitFor({ timeout: 20000 });
  check('submitted for approval with the keyboard only', true);
  await ctx.close();
}

// ---- 3. Reflow: no horizontal scrolling at 320 px wide or 200% zoom ----
for (const [name, size] of [['320 px wide', { width: 320, height: 640 }], ['200% zoom (640x450)', { width: 640, height: 450 }]]) {
  const ctx = await browser.newContext({ viewport: size }); const p = await ctx.newPage();
  await p.goto(WEB + '/'); await p.getByText('Rajan · Manager').first().click(); await p.waitForURL('**/queue');
  const bad = [];
  for (const path of ['/', '/queue', '/review', '/brand', '/dashboard', '/audit', '/about', '/roadmap']) {
    await p.goto(WEB + path); await p.waitForTimeout(1500);
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push(path);
  }
  check(`reflow at ${name}: no page-level horizontal scroll`, bad.length === 0, bad.join(', '));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll keyboard and reflow checks passed');
process.exit(failed ? 1 : 0);
