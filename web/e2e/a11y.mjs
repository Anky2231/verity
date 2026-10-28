// Automated accessibility audit (axe-core, WCAG 2.0/2.1 A and AA plus best practices) of every page, in light and dark mode.
// Usage: WEB=http://127.0.0.1:3000 node e2e/a11y.mjs [--json]   (stack must be running; exits 1 on serious/critical issues)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const WEB = process.env.WEB || 'http://127.0.0.1:3000';
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let blocking = 0;
const rows = [];

async function audit(page, label, scheme) {
  await page.addScriptTag({ content: AXE });
  const res = await page.evaluate((tags) => axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS);
  for (const v of res.violations) {
    const heavy = ['serious', 'critical'].includes(v.impact);
    if (heavy) blocking++;
    rows.push({ page: label, scheme, id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes[0]?.target?.join(' ') });
  }
  console.log(`${res.violations.some((v) => ['serious', 'critical'].includes(v.impact)) ? 'FAIL' : 'ok  '}  ${scheme.padEnd(5)} ${label}  (${res.violations.length} issue types, ${res.passes.length} rules passed)`);
}

for (const scheme of ['light', 'dark']) {
  // The site is dark unless a choice is saved, so each pass saves its own theme: the "light" pass really audits the light theme.
  const ctx = async () => { const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme }); await c.addInitScript((t) => localStorage.setItem('verity_theme', t), scheme); return c; };
  const login = async (page, label) => { await page.goto(WEB + '/'); await page.getByText(label).first().click(); await page.waitForURL('**/queue'); await page.waitForSelector('tbody tr', { timeout: 60000 }); };

  // public pages
  let c = await ctx(); let p = await c.newPage();
  for (const path of ['/', '/about', '/roadmap']) { await p.goto(WEB + path); await p.waitForTimeout(1500); await audit(p, path, scheme); }
  await c.close();

  // creator pages
  c = await ctx(); p = await c.newPage(); await login(p, 'Maya · Creator');
  await audit(p, '/queue (creator)', scheme);
  await p.goto(WEB + '/visual'); await p.waitForTimeout(1200); await audit(p, '/visual (new image review)', scheme);
  await p.goto(WEB + '/queue'); await p.waitForSelector('tbody tr');
  await p.locator('select[aria-label="Status filter"]').selectOption('draft'); await p.waitForTimeout(1000);
  const hrefs = await p.locator('tbody tr a').evaluateAll((a) => a.map((x) => x.getAttribute('href')));
  for (const h of hrefs.slice(0, 15)) { await p.goto(WEB + h); await p.waitForTimeout(1800); if (await p.locator('.item').count()) break; }
  await audit(p, '/review (creator, with flags)', scheme);
  await p.locator('.item').first().click();
  await p.getByRole('button', { name: 'Dispute', exact: true }).click(); await p.getByRole('dialog').waitFor();
  await audit(p, '/review (reason dialog open)', scheme);
  await p.keyboard.press('Escape');
  await c.close();

  // manager pages
  c = await ctx(); p = await c.newPage(); await login(p, 'Rajan · Manager');
  await audit(p, '/queue (manager)', scheme);
  for (const path of ['/brand', '/dashboard', '/drift', '/audit']) { await p.goto(WEB + path); await p.waitForTimeout(2500); await audit(p, path, scheme); }
  await p.goto(WEB + '/brand'); await p.getByText('Use sample guideline').click(); await p.getByText('Preview what was extracted').waitFor(); await audit(p, '/brand (extraction preview)', scheme);
  await c.close();
}
await browser.close();

if (process.argv.includes('--json')) fs.writeFileSync('a11y-report.json', JSON.stringify(rows, null, 2));
const byRule = {};
for (const r of rows) { const k = `${r.impact}\t${r.id}`; (byRule[k] ??= { ...r, where: new Set() }).where.add(`${r.page} [${r.scheme}]`); }
console.log('\n--- violations by rule');
for (const [k, v] of Object.entries(byRule).sort()) console.log(`${k.replace('\t', ' ')}: ${v.help} | ${[...v.where].length} page/mode combos | e.g. ${v.sample} on ${[...v.where][0]}`);
console.log(blocking ? `\n${blocking} serious/critical findings` : '\nNo serious or critical accessibility violations');
process.exit(blocking ? 1 : 0);
