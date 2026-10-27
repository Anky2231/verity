export const metadata = { title: 'Round 3 — Verity', description: 'The three Round 3 improvements: what shipped, how it was tested, and what is still limited' };

// Every number here is printed by a script in the repository; the command to reproduce it is on each card.
const ITEMS = [
  { name: 'VisualGuard: image and logo compliance',
    shipped: 'Upload a banner or graphic as an image review. Problems are marked with numbered boxes and the guideline clause: colours outside the palette, a retired logo, an approved logo that is stretched, squashed, recoloured or crowded (or too close to the edge). Each brand has its own logos, retired logos and palette, managed on the Brand page. Findings, scores, decisions, approval and the audit trail work exactly as for text.',
    how: 'Classical image processing, so it is free and repeatable: colours are clustered in Lab space and compared with the palette; logos are found by template matching on edge maps, first over many sizes and stretches on a small copy, then precisely. A second pass on colour edges finds logos recoloured to the same lightness as the background.',
    target: 'At least 85% of planted violations found, at most 10% false flags, on 30 images.',
    result: 'Held-out set (run once, after tuning on a separate dev set): 22 of 22 violations found with the right rule and a box on the right place; 0 of 8 compliant images flagged. Stress set (20 images, never tuned on): 9 of 15 found, 1 of 5 compliant images wrongly flagged.',
    limits: ['The test images are synthetic and use the same logo files the checker is given, so real designs will score lower.', 'Rotated and partly cropped logos are missed; a photographic background is reported as off-palette.', 'It recognises the brand’s own logo files, not a general sense of “off-brand”, and checks one image at a time up to 1200 px.'],
    reproduce: 'cd ai && .venv/bin/python scripts/visual_eval.py both  ·  cd web && npm run visual' },
  { name: 'Multi-brand workspaces (agency mode)',
    shipped: 'One person can belong to several brands with a different role in each (Maya is a creator at Lumina and a manager at Northwind). The header switcher changes guidelines, reviews, audit trail (each brand has its own hash chain), dashboard, drift and notifications together. Wording from the user’s other brands is flagged as “other brand”. Managers create read-only client report links: expiring, revocable, stored as hashes, showing scores and statuses but never content, comments or team names.',
    how: 'Every request carries the active brand; the API checks the user’s membership and takes the role from it. A brand you do not belong to and a brand that does not exist give the same answer. The other-brand check compares the text with the other brands’ names, approved terms, claims and tone examples.',
    target: 'No cross-brand reads or changes; at least 80% of planted cross-brand wording flagged.',
    result: 'Every review route is called from the other brand and must answer 404; the test fails if the brand filter is removed. Contamination: 18 of 21 planted samples flagged (86%), 0 of 18 clean texts flagged (39 hand-written texts).',
    limits: ['Wording that uses no listed term, claim or name (voice only) is not caught: 0 of 3.', 'The contamination set was written after the detector and is small.', 'Viewing a report link is not written to the audit trail.'],
    reproduce: 'cd api && node --test test/multibrand.test.js test/share.test.js  ·  cd ai && .venv/bin/python scripts/contamination_eval.py  ·  cd web && npm run multibrand' },
  { name: 'Brand Drift Intelligence',
    shipped: 'The Drift page compares each team’s violations per 100 words over the last 3 weeks with that team’s own first 4 weeks, flags teams that are drifting, names the clauses most likely to be broken next, draws trend charts (with tables), and keeps a weekly digest. Managers get an alert once per team per week.',
    how: 'A team drifts when the rise is at least 3.5 standard errors (from a Poisson model widened by a dispersion factor measured on the baseline) and at least 1.3 times the baseline. Plain arithmetic on stored reviews: no model and no cost.',
    target: 'An alert within one window (3 weeks) of the drift starting, and no alert on a stable team.',
    result: 'Simulation, 500 held-out series (thresholds chosen on 300 other series): stable teams alerted 4.6% of the time; a step to 2.2 times the baseline was caught within 3 weeks in 92% of runs (median delay 1 week); a four-week ramp in 71%; a mild step to 1.6 times in 45%. On the seeded history the planted Social drift is found and the other three teams stay stable.',
    limits: ['The history is simulated and seeded; no real team data existed.', 'A team needs about 7 weeks of history, and mild or slow drifts are caught late or not at all.', 'Tone embeddings are not used. The digest is created on the first view each week because the free host has no scheduler.'],
    reproduce: 'cd api && npm run drift-eval  ·  node --test test/drift.test.js test/drift-api.test.js  ·  cd web && npm run drift' },
];

const Field = ({ k, v }) => <p style={{ margin: '6px 0' }}><b>{k}.</b> {v}</p>;

export default function Round3() {
  return (
    <div className="doc">
      <p className="muted" style={{ margin: 0 }}><a href="/">← Home</a> · <a href="/about">What changed since Round 1</a></p>
      <h1 style={{ marginBottom: 4 }}>Round 3: the three improvements</h1>
      <p className="muted" style={{ marginTop: 0 }}>The three improvements promised in Round 2 are built. Each card says what shipped, what the test target was, what was measured, and what is still limited. Nothing here is estimated: every number is printed by a script in the repository (command at the bottom of each card).</p>
      {ITEMS.map((x, i) => (
        <section key={x.name} className="card" style={{ marginTop: 16 }}>
          <h2 style={{ margin: '0 0 8px' }}>{i + 1}. {x.name} <span className="badge green">Built</span></h2>
          <Field k="What shipped" v={x.shipped} /><Field k="How it works" v={x.how} /><Field k="Test target" v={x.target} /><Field k="Result" v={x.result} />
          <p style={{ margin: '6px 0 2px' }}><b>Limits</b></p>
          <ul style={{ margin: 0 }}>{x.limits.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="muted" style={{ margin: '8px 0 0' }}>Reproduce: <code>{x.reproduce}</code></p>
        </section>))}
      <h2>Still not done, and not claimed</h2>
      <ul>
        <li>ToneGuard runs in its rule-based basic mode on this demo; the LLM path is built but not switched on, so subtle voice problems are not caught.</li>
        <li>No usability test with people outside the team and no screen-reader test; automated accessibility checks and a keyboard-only run were done.</li>
        <li>Demo data is shared by every visitor, and the teams, the Northwind brand and the drift history are seeded.</li>
        <li>The free host sleeps when idle; the landing page says so and continues by itself once the server is awake.</li>
      </ul>
    </div>
  );
}
