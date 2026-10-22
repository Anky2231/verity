export const metadata = { title: 'Roadmap — Verity', description: 'Three planned Round 3 improvements' };

const ITEMS = [
  { name: 'VisualGuard: image and logo compliance',
    problem: 'Brand violations are not only words. Wrong logo versions, off-palette colours and altered logos slip through because text review cannot see them.',
    story: 'As a creator, I upload a banner and see the same kind of flag on the image, with the guideline clause, so I can fix it before it reaches a manager.',
    design: 'CLIP embeddings of approved logos and images compared by cosine similarity against thresholds; palette check by colour quantisation against the brand palette; logo clear-space and misuse checks. Output uses the existing Finding schema (with a bounding-box region), so the findings panel and MetaAgent need no changes.',
    data: 'brand_assets(brand_id, kind, filename, mime, data) for approved logos, images and palette. Findings keep their current shape, with region instead of span.',
    test: 'Visual violation recall of at least 85% on a 30-image test set, with at most 10% false flags on compliant images.',
    effort: 'About 1.5 weeks: embeddings and thresholds, palette and logo checks, upload UI, benchmark set.',
    built: ['brand_assets table (migration 002), empty', 'Role-guarded upload route that answers 501 "coming in Round 3"', 'region field in the Finding schema and the AI service model', '"VisualGuard · Round 3" slot in the review summary'] },
  { name: 'Multi-brand workspaces (agency mode)',
    problem: 'Agencies manage many brands. Today one demo brand is wired in, and mixing guidelines between clients is a real risk.',
    story: 'As an agency manager, I switch between client brands, each with its own guidelines, reviews and analytics, and I can send a client a read-only compliance report.',
    design: 'Brand switcher; isolated BIG, workflow and analytics per brand; per-brand role memberships; a contamination detector that flags one brand’s tone in another brand’s content; shareable read-only report link.',
    data: 'brand_id on every table already; add brand_memberships(user_id, brand_id, role) and a share-token table for reports.',
    test: 'A user in Brand A can never read or change Brand B data (automated cross-brand access tests pass), and the contamination detector flags at least 80% of planted cross-brand samples.',
    effort: 'About 1 week: membership model and scoping, switcher UI, report link, contamination check.',
    built: ['brand_id column on every table', 'A second brand row (Northwind Tea Co.) in the seed', 'Review and audit queries already filter by brand; the brand is currently a constant in the API, to be replaced by the user’s active brand'] },
  { name: 'Brand Drift Intelligence',
    problem: 'Teams drift away from the guidelines slowly. Individual reviews miss the pattern until it is a problem.',
    story: 'As a brand manager, I see which teams and clauses are drifting over time and get an alert before violations pile up.',
    design: 'Rolling-window analysis of tone embeddings against the brand centroid, a per-team drift score with a threshold alert, predicted likely violations from historical patterns, and a weekly digest.',
    data: 'Per-revision tone embeddings stored next to the revision; a drift_scores(brand_id, team, window, score) table.',
    test: 'On a seeded history with a planted drift, the alert fires within one window of the drift start, with no alert on the stable control series.',
    effort: 'About 1.5 weeks: embeddings storage, drift scoring, trend chart, alerting and digest.',
    built: ['Every revision is stored with a timestamp, score and findings, which is the history drift will analyse', '40 seeded historical reviews for demonstrating trends', 'The override-rate analysis that already surfaces ambiguous clauses', 'Tone embeddings and a trend chart are not built yet'] },
];

const Field = ({ k, v }) => <p style={{ margin: '6px 0' }}><b>{k}.</b> {v}</p>;

export default function Roadmap() {
  return (
    <main className="doc">
      <p className="muted" style={{ margin: 0 }}><a href="/">← Home</a> · <a href="/about">What changed since Round 1</a></p>
      <h1 style={{ marginBottom: 4 }}>Round 3 roadmap: three improvements</h1>
      <p className="muted" style={{ marginTop: 0 }}>The three improvements named in Round 1, each with its design, data model and a measurable acceptance test. None of the features below is built yet; the last line of each card lists exactly what groundwork exists today.</p>
      {ITEMS.map((x, i) => (
        <section key={x.name} className="card" style={{ marginTop: 16 }}>
          <h2 style={{ margin: '0 0 8px' }}>{i + 1}. {x.name}</h2>
          <Field k="Problem" v={x.problem} /><Field k="User story" v={x.story} /><Field k="Technical design" v={x.design} />
          <Field k="Data model" v={x.data} /><Field k="Acceptance test" v={x.test} /><Field k="Effort" v={x.effort} />
          <p style={{ margin: '6px 0 2px' }}><b>Already in place</b></p>
          <ul style={{ margin: 0 }}>{x.built.map((b) => <li key={b}>{b}</li>)}</ul>
        </section>))}
    </main>
  );
}
