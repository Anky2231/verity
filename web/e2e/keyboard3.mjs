// Keyboard-only use of the Round 3 screens: the image review (boxes, problem list, reason dialog) and the drift page.
// Setup (creating the review, signing in) uses the API and the mouse once; everything checked is done with Tab, Enter, Space and Escape.
// Usage: WEB=http://127.0.0.1:3000 API=http://127.0.0.1:4000 node e2e/keyboard3.mjs   (stack and AI service must be running)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = process.env.WEB || 'http://127.0.0.1:3000', API = process.env.API || 'http://127.0.0.1:4000';
const SET = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ai', 'eval', 'visual');
const labels = JSON.parse(fs.readFileSync(path.join(SET, 'heldout.json'), 'utf8'));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };

// An image review with problems, made through the API as Maya (Lumina).
const login = async (role) => (await (await fetch(`${API}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) })).json()).token;
const token = await login('creator');
const call = async (method, p, body) => (await fetch(`${API}${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-brand-id': 'lumina' }, body: body && JSON.stringify(body) })).json();
const review = await call('POST', '/reviews', { title: 'Keyboard banner', content_type: 'image' });
const lab = labels.find((l) => l.kind === 'recoloured');
const run = await call('POST', `/reviews/${review.id}/image`, { filename: 'k.jpg', content_base64: fs.readFileSync(path.join(SET, lab.file)).toString('base64') });
if (!run.highlights?.length) throw new Error('setup: the image review has no problems to navigate');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await p.goto(WEB + '/'); await p.getByRole('button', { name: /Maya · Creator/ }).click(); await p.waitForURL('**/queue');
await p.goto(`${WEB}/visual?id=${review.id}`);
await p.getByText(/Problem 1/).first().waitFor({ timeout: 30000 });

const focused = () => p.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}|${e.getAttribute('aria-label') ?? e.textContent.trim().slice(0, 30)}` : ''; });
const tabTo = async (test, max = 60) => { for (let i = 0; i < max; i++) { await p.keyboard.press('Tab'); if (test(await focused())) return true; } return false; };

check('Tab reaches the numbered box on the image', await tabTo((f) => /^BUTTON\|Problem 1:/.test(f)));
await p.keyboard.press('Enter');
check('Enter on the box selects its problem', (await p.locator('button[aria-label^="Problem 1:"]').first().getAttribute('aria-pressed')) === 'true');
check('Tab reaches the problem list and its Dispute button', await tabTo((f) => /^BUTTON\|Dispute/.test(f)));
await p.keyboard.press('Enter');
await p.getByRole('dialog').waitFor();
check('the reason dialog takes focus into its text box', await p.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', null, { timeout: 3000 }).then(() => true, () => false));
await p.keyboard.press('Escape');
await p.getByRole('dialog').waitFor({ state: 'detached' });
check('Escape closes the dialog and focus returns to Dispute', /^BUTTON\|Dispute/.test(await focused()));
await p.keyboard.press('Enter');
await p.getByRole('dialog').waitFor();
await p.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');   // focus arrives a frame after the dialog opens
await p.keyboard.type('Approved by the partner.');
await tabTo((f) => /^BUTTON\|Continue/.test(f), 5);
await p.keyboard.press('Enter');
await p.getByText('Reason: Approved by the partner.').waitFor({ timeout: 10000 });
check('a dispute can be made and saved with the keyboard alone', true);

// Drift page
await p.goto(WEB + '/'); await p.getByRole('button', { name: /Rajan · Manager/ }).click(); await p.waitForURL('**/queue');
await p.goto(WEB + '/drift'); await p.getByRole('heading', { name: 'Teams', exact: true }).waitFor();
check('Tab reaches the "view as a table" control of a chart', await tabTo((f) => /^SUMMARY\|View the same data as a table/.test(f), 80));
await p.keyboard.press('Enter');
const opened = await p.waitForFunction(() => document.querySelectorAll('details[open] table tbody tr').length >= 3, null, { timeout: 3000 }).then(() => true, () => false);
check('Enter opens the chart\'s data table', opened, `rows=${await p.locator('details[open] table tbody tr').count()}`);
await p.keyboard.press('Enter');
check('Enter closes it again', await p.waitForFunction(() => document.querySelectorAll('details[open]').length === 0, null, { timeout: 3000 }).then(() => true, () => false));

await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll Round 3 keyboard checks passed');
process.exit(failed ? 1 : 0);
