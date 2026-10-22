// End-to-end journey against a running stack. Uses the system Chrome via playwright-core (no browser download).
// Usage: WEB=http://127.0.0.1:3000 API=http://127.0.0.1:4000 node e2e/journey.mjs [screenshotDir]
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = process.env.WEB || 'http://127.0.0.1:3000', API = process.env.API || 'http://127.0.0.1:4000';
const SHOTS = process.argv[2];
const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
const shot = (p, n) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${n}.png`) });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function ctx(role) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB }).catch(() => {});
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/404|favicon/.test(m.text()) && errors.push(m.text()));
  return p;
}

// ---- 1. Judge walkthrough start, guideline upload and publish (Manager) ----
let p = await ctx();
await p.goto(WEB + '/');
await p.getByText('Start judge walkthrough').click();
await p.waitForURL('**/brand');
check('walkthrough start lands on /brand as manager', true);
await p.getByText('Use sample guideline').click();
await p.getByText('Preview what was extracted').waitFor();
check('extraction preview shows 3 rules, 3 terms, 3 claims', (await p.getByText('Rules (3)').count()) && (await p.getByText('Approved terms (3)').count()) && (await p.getByText('Approved claims (3)').count()));
await p.locator('textarea[aria-label="Rule text"]').first().fill('Write in a warm, plain-spoken voice. No corporate jargon or hype.');
await p.getByText('Delete', { exact: false }).first().waitFor();
await shot(p, '1-preview');
await p.getByText('Publish as new version').click();
await p.getByText(/Published as version \d+/).waitFor();
check('publish creates a new BIG version', true);
check('walkthrough step 1 ticked', (await p.getByLabel('done').count()) >= 1);
// upload a real PDF through the file input
await p.locator('input[type=file]').setInputFiles(path.join(here, '..', 'public', 'sample', 'lumina-brand-guidelines.pdf'));
await p.getByText('Preview what was extracted').waitFor();
check('real PDF upload extracts rules', (await p.getByText('Rules (3)').count()) === 1);
await p.getByText('Discard').click();

// ---- 2. Creator: review sample with streamed progress, fix, dispute, re-run, submit ----
await p.getByRole('navigation', { name: 'Judge walkthrough' }).getByText('Review sample content').click();
await p.waitForURL('**/review');
await p.getByText('Load sample content').click();
await p.getByText('Run Verity review').click();
await p.getByText(/ToneGuard · \d/).waitFor({ timeout: 30000 });
await p.waitForSelector('.flag', { timeout: 30000 });
const n1 = await p.locator('.flag').count();
check('review ran with streamed agent chips and highlights', n1 >= 5, `flags=${n1}`);
check('three agent chips + VisualGuard slot', (await p.locator('.chip.ok').count()) === 3 && (await p.getByText('VisualGuard · Round 3').count()) === 1);
await p.getByText('Agent run details').click();
check('run details show timing', await p.getByText(/First agent result in/).isVisible());
await shot(p, '2-review');
const items = p.locator('.item'); const cnt = await items.count();
let accepted = false;
for (let i = 0; i < cnt && !accepted; i++) { await items.nth(i).click(); const b = p.getByText('Accept fix'); if (await b.isEnabled()) { await b.click(); accepted = true; } }
check('accept fix applied', accepted);
await p.waitForTimeout(600);
await items.first().click();
const disputeBtn = p.getByRole('button', { name: 'Dispute', exact: true });
await disputeBtn.click();
const dlg = p.getByRole('dialog');
await dlg.waitFor();
const focused = await p.waitForFunction(() => document.activeElement?.id === 'reason-dialog-input', null, { timeout: 3000 }).then(() => true, () => false);
check('reason dialog opens with focus in the text box', focused);
await dlg.getByRole('button', { name: 'Continue' }).click();
check('empty reason shows an error and keeps the dialog open', (await dlg.getByRole('alert').count()) === 1 && await dlg.isVisible());
await p.keyboard.press('Escape');
await dlg.waitFor({ state: 'hidden' });
check('Escape closes the dialog and returns focus to the trigger', await disputeBtn.evaluate((el) => el === document.activeElement));
await disputeBtn.click();
await p.getByRole('dialog').locator('textarea').fill('This phrasing suits our trade audience.');
await p.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
await p.waitForTimeout(600);
check('decisions panel lists accept + dispute', (await p.getByText(/Decisions and reasons \(2\)/).count()) === 1);
await p.getByText('Re-run review').click();
await p.getByText(/Since revision 1/).waitFor({ timeout: 30000 });
check('re-run shows compliance delta', true);
await p.locator('.diff-add, .diff-del').first().waitFor({ timeout: 10000 });
check('revision diff visible', await p.locator('.diff-add, .diff-del').first().isVisible());
await shot(p, '3-diff');
const reviewUrl = p.url();
await p.getByRole('button', { name: 'Submit for approval', exact: true }).click();
await p.getByText(/text is locked/).waitFor({ timeout: 15000 });
check('submitted; editor locked', (await p.getByText(/text is locked/).count()) === 1);
const creatorPage = p;

// ---- 3. Manager: open, override, manual flag, comment, approve ----
const m = await ctx();
await m.goto(WEB + '/'); await m.getByText('Rajan · Manager').click(); await m.waitForURL('**/queue');
await m.locator('select[aria-label="Status filter"]').selectOption('submitted');
await m.waitForTimeout(700);
check('manager queue shows submitted review with Δ and age columns', (await m.getByText('Δ').count()) >= 1 && (await m.locator('tbody tr').count()) >= 1);
await m.goto(reviewUrl); await m.getByText('Review summary').waitFor();
await m.locator('.item').first().click();
await m.getByRole('button', { name: 'Override', exact: true }).click();
await m.getByRole('dialog').locator('textarea').fill('Acceptable for this audience.');
await m.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
await m.waitForTimeout(500);
// manual flag: select some text in the editor
await m.locator('.ProseMirror p').first().click({ clickCount: 3 });
await m.getByText('Flag selected text').click();
await m.getByRole('dialog').locator('textarea').fill('Off-brand opener.');
await m.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
check('manager override + manual flag recorded', true);
await m.getByLabel('Add a comment').fill('Looks close. Approving after the claim fix.');
await m.getByRole('button', { name: 'Comment', exact: true }).click();
await m.getByText(/Looks close/).waitFor();
await shot(m, '4-manager');
await m.getByRole('button', { name: 'Approve', exact: true }).click();
await m.locator('h1 .badge', { hasText: 'Approved' }).waitFor();
check('manager approved', true);
await m.getByText('Export approved content').waitFor();
const [dl] = await Promise.all([m.waitForEvent('download'), m.getByText('Download .md').click()]);
check('export .md downloads', dl.suggestedFilename().endsWith('.md'));
await m.getByRole('button', { name: 'Mark as published', exact: true }).click(); await m.locator('h1 .badge', { hasText: 'Published' }).waitFor();
check('human "Mark as published" (no auto-publish)', true);

// creator sees notification
await creatorPage.goto(WEB + '/queue'); await creatorPage.getByRole('button', { name: /Notifications/ }).click();
check('creator notified of approval', await creatorPage.getByText(/was approved/).first().isVisible());

// ---- 4. Escalation path: Rajan escalates a seeded submitted review, Anita signs off ----
await m.goto(WEB + '/queue'); await m.locator('select[aria-label="Status filter"]').selectOption('submitted'); await m.waitForTimeout(600);
await m.locator('tbody tr').first().getByRole('button', { name: 'Escalate to approver', exact: true }).click(); await m.waitForTimeout(600);
const a = await ctx(); await a.goto(WEB + '/'); await a.getByText('Anita · Approver').click(); await a.waitForURL('**/queue');
await a.locator('select[aria-label="Status filter"]').selectOption('escalated'); await a.waitForTimeout(600);
const before = await a.locator('tbody tr').count();
await a.locator('tbody tr').first().getByRole('button', { name: 'Final approve', exact: true }).click(); await a.waitForTimeout(700);
check('approver final-approves an escalated review', (await a.locator('tbody tr').count()) === before - 1);

// ---- 5. Dashboard + audit ----
await m.goto(WEB + '/dashboard'); await m.getByText('Score trend').waitFor();
check('dashboard cards + charts', (await m.getByText('Average score', { exact: true }).count()) === 1 && (await m.locator('svg circle').count()) >= 3 && (await m.getByText('Violations by agent').count()) === 1);
check('ambiguous clause surfaced', (await m.getByText('possibly ambiguous').count()) >= 1);
await shot(m, '5-dashboard');
await m.goto(WEB + '/audit'); await m.getByRole('button', { name: 'Verify chain', exact: true }).click();
await m.getByText(/Chain intact/).waitFor();
check('audit chain verifies', true);
check('audit has BIG publish + review events', (await m.getByText('big.published').count()) >= 1);

// ---- 6. RBAC in the UI + phone widths ----
await creatorPage.goto(WEB + '/audit'); await creatorPage.waitForTimeout(500);
check('creator cannot open audit', (await creatorPage.getByText(/visible to managers and approvers/).count()) === 1);
for (const route of ['/', '/queue', '/review', '/brand', '/dashboard', '/audit', '/about', '/roadmap']) {
  const ph = await browser.newContext({ viewport: { width: 375, height: 812 } }); const pg = await ph.newPage();
  await pg.goto(WEB + '/'); await pg.getByText('Rajan · Manager').click(); await pg.waitForURL('**/queue');
  await pg.goto(WEB + route); await pg.waitForTimeout(900);
  check(`phone width ${route}: no page-level horizontal scroll`, !(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  if (route === '/queue') await shot(pg, '6-phone-queue');
  await ph.close();
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
