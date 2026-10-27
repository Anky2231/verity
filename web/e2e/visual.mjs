// VisualGuard in a real browser, against the real AI service: upload images, see numbered boxes, decide, resubmit, approve,
// manage the brand's logos and palette, and see that a second brand checks against its own assets.
// Usage: WEB=http://127.0.0.1:3000 node e2e/visual.mjs   (stack and AI service must be running; creates image reviews)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const WEB = process.env.WEB || 'http://127.0.0.1:3000';
const here = path.dirname(fileURLToPath(import.meta.url));
const SET = path.join(here, '..', '..', 'ai', 'eval', 'visual');
const labels = JSON.parse(fs.readFileSync(path.join(SET, 'heldout.json'), 'utf8'));
const img = (kind) => path.join(SET, labels.find((l) => l.kind === kind).file);
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
const serious = async (p, scope) => { await p.addScriptTag({ content: AXE }); const r = await p.evaluate((s) => axe.run(s ? document.querySelector(s) : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }), scope ?? null); return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)); };

// ---- Maya, creator at Lumina: a recoloured-logo banner ----
let p = await open();
await login(p, /Maya · Creator/);
await p.getByRole('link', { name: 'New image review' }).first().click();
await p.waitForURL('**/visual');
await p.getByLabel('Title').fill('Spring banner');
await p.locator('input[type=file]').setInputFiles(img('recoloured'));
await p.getByRole('button', { name: 'Check image' }).click();
await p.waitForURL(/\/visual\?id=\d+/, { timeout: 60000 });
await p.getByRole('heading', { name: 'Spring banner' }).waitFor();
await p.getByText(/Problem 1/).first().waitFor({ timeout: 30000 });
const reviewUrl = p.url();
check('the checked image is shown, not a broken picture', await p.locator('img[alt^="Uploaded image"]').evaluate((i) => i.complete && i.naturalWidth > 0));
check('the score is below 100', /score\s*\d+\/100/.test(await p.locator('body').innerText()) && !/score\s*100\/100/.test(await p.locator('body').innerText()));
const boxes = await p.locator('button[aria-label^="Problem"]').count();
check('there is a numbered box on the image for each problem', boxes >= 1, `boxes=${boxes}`);
check('the recoloured logo is named with its guideline clause', (await p.getByText('Visual §2.2 Logo colours').count()) >= 1);
const box = p.locator('button[aria-label^="Problem 1"]').first();
const where = await box.evaluate((b) => { const r = b.getBoundingClientRect(), i = document.querySelector('img[alt^="Uploaded image"]').getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.left >= i.left - 1 && r.right <= i.right + 1 && r.top >= i.top - 1 && r.bottom <= i.bottom + 1; });
check('the box sits inside the image and has a real size', where);
await box.click();
check('clicking a box selects the matching problem', (await box.getAttribute('aria-pressed')) === 'true');
check('the image review page passes the accessibility audit', (await serious(p)).length === 0);

// dispute with a reason
await p.getByRole('button', { name: 'Dispute' }).first().click();
const dlg = p.getByRole('dialog'); await dlg.waitFor();
await dlg.getByRole('button', { name: 'Continue' }).click();
check('an empty reason is refused', (await dlg.getByRole('alert').count()) === 1);
await dlg.locator('textarea').fill('The partner asked for the blue version.');
await dlg.getByRole('button', { name: 'Continue' }).click();
await p.getByText('disputed').first().waitFor();
await p.getByText('Reason: The partner asked for the blue version.').waitFor({ timeout: 5000 }).catch(() => {});
check('the dispute is recorded with its reason', (await p.getByText('Reason: The partner asked for the blue version.').count()) === 1, (await p.locator('section[aria-label="Problems found"]').innerText()).replace(/\s+/g, ' ').slice(0, 300));

// a new version that is compliant
await p.locator('input[aria-label="Upload an image"]').setInputFiles(img('compliant'));
await p.getByText('revision 2').waitFor({ timeout: 60000 });
const compliantBody = await p.locator('body').innerText();
check('a compliant image has no problems and scores 100', /No problems found/.test(compliantBody) || /score\s*100\/100/.test(compliantBody));
await p.getByRole('button', { name: 'Submit for approval', exact: true }).click();
await p.getByText('Submitted').first().waitFor();
check('an image review goes through the same approval workflow', true);
await p.close();

// ---- Rajan approves it from the queue ----
p = await open(); await login(p, /Rajan · Manager/);
await p.locator('select[aria-label="Status filter"]').selectOption('submitted');
await p.getByRole('link', { name: 'Spring banner' }).first().click();
await p.waitForURL(/\/visual\?id=\d+/);
check('the queue opens an image review on the image page', true);
await p.getByRole('button', { name: 'Approve', exact: true }).click();
await p.getByText('Approved').first().waitFor();
check('the manager can approve it', true);
await p.close();

// ---- Other violations are found by the right rule ----
p = await open(); await login(p, /Maya · Creator/);
for (const [kind, clause] of [['palette', 'Visual §1.1 Colour palette'], ['retired', 'Visual §2.4 Retired logo'], ['distorted', 'Visual §2.1 Logo proportions']]) {
  await p.goto(WEB + '/visual');
  await p.locator('input[type=file]').setInputFiles(img(kind));
  await p.getByRole('button', { name: 'Check image' }).click();
  await p.waitForURL(/\/visual\?id=\d+/, { timeout: 60000 });
  await p.getByText(/Problem 1/).first().waitFor({ timeout: 30000 });
  check(`a ${kind} image is reported as ${clause}`, (await p.getByText(clause).count()) >= 1);
}
await p.goto(WEB + '/visual'); await p.locator('input[type=file]').setInputFiles(path.join(here, '..', 'package.json'));
await p.getByRole('button', { name: 'Check image' }).click();
await p.locator('main [role=alert]').waitFor();
check('a file that is not an image is refused with a plain message', /PNG, JPEG, WebP or GIF/.test(await p.locator('main [role=alert]').innerText()));
await p.setViewportSize({ width: 320, height: 700 });
await p.goto(WEB + reviewUrl.slice(WEB.length)); await p.getByRole('heading', { name: 'Spring banner' }).waitFor(); await p.waitForLoadState('networkidle');
check('the image page fits a 320 px screen', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
await p.close();

// ---- Brand assets, as the manager ----
p = await open(); await login(p, /Rajan · Manager/);
await p.goto(WEB + '/brand');
await p.getByRole('heading', { name: 'Colour palette' }).waitFor();
check('the palette shows the four Lumina colours', (await p.locator('section[aria-labelledby=assets-h] li').count()) >= 4);
await p.waitForFunction(() => [...document.querySelectorAll('section[aria-labelledby=assets-h] img')].length >= 2 && [...document.querySelectorAll('section[aria-labelledby=assets-h] img')].every((i) => i.complete && i.naturalWidth > 0));
check('both Lumina logos are shown as pictures', true);
check('the retired logo is labelled as retired', (await p.getByText('Retired logo').count()) >= 1);
await p.getByLabel('Name', { exact: false }).first().fill('Sky');
await p.getByRole('button', { name: 'Add colour' }).click();
await p.getByRole('button', { name: 'Remove colour Sky' }).waitFor();
await p.getByRole('button', { name: 'Remove colour Sky' }).click();
await p.waitForFunction(() => !document.body.innerText.includes('Sky #'));
check('a colour can be added and removed', true);
check('the brand assets section passes the accessibility audit', (await serious(p, 'section[aria-labelledby=assets-h]')).length === 0);
await p.close();

// ---- A second brand checks against its own assets ----
p = await open(); await login(p, /Maya · Creator/);
await p.getByRole('button', { name: /Brand:/ }).click();
await p.getByRole('menuitem', { name: /Northwind Tea Co\./ }).click();
await p.getByRole('button', { name: /Brand:.*Northwind/ }).waitFor();
await p.goto(WEB + '/brand'); await p.getByRole('heading', { name: 'Colour palette' }).waitFor();
check('Northwind has its own palette', (await p.getByText('Tea green').count()) >= 1 && (await p.getByText('Amber').count()) === 0);
await p.goto(WEB + '/visual'); await p.locator('input[type=file]').setInputFiles(img('compliant'));
await p.getByRole('button', { name: 'Check image' }).click();
await p.waitForURL(/\/visual\?id=\d+/, { timeout: 60000 });
await p.getByText(/Problem 1/).first().waitFor({ timeout: 30000 });
check('an image that is on-palette for Lumina is off-palette for Northwind', (await p.getByText('Visual §1.1 Colour palette').count()) >= 1);
await p.close();

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll VisualGuard checks passed');
process.exit(failed ? 1 : 0);
