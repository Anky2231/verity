export const metadata = { title: 'About — Verity', description: 'What changed since Round 1' };

const TONE = { Done: 'green', Simplified: '', 'In progress': 'amber', 'Planned R3': '' };
const Status = ({ s }) => <span className={`badge ${TONE[s] ?? ''}`}>{s}</span>;

// Honest status only: "Done" means it runs in this deployment and has the evidence listed.
const MVP = [
  ['Brand Intelligence Graph builder', 'Simplified',
    'Managers upload a PDF, DOCX, TXT or MD guideline (or use the sample). Rules, approved terms, approved claims with source pages, and the voice profile are extracted, shown in an editable preview with notes on anything unclear, and published as a new immutable version. Extraction is rule-based rather than LLM-based, and there are no tone embeddings yet.',
    'ai/app/extract.py · api/src/routes/brand.js · /brand page · tests for real PDF and DOCX'],
  ['Multi-agent review engine', 'Simplified',
    'ToneGuard, TermGuard and ClaimGuard run in parallel with per-agent failure isolation; one agent failing does not block the others. Results stream as each agent finishes. With REDIS_URL, the API runs independent BullMQ jobs and the AI service merges their AgentResults; without it, the direct asyncio pipeline remains active. ToneGuard runs in labelled basic mode on this deployment. TermGuard also recognises singular, plural and hyphen variants and honours allowed contexts, and the compliance score counts each highlight once.',
    'ai/app/pipeline.py, ai/app/main.py (/review/{agent}, /merge), api/src/queue.js, api/src/routes/reviews.js and queue integration tests'],
  ['Inline annotation editor', 'Done',
    'TipTap editor with highlights for every flag, severity colours, click-to-select, and flags that follow the text as it is edited.',
    'web/components/flagHighlights.js · web/app/review/page.js'],
  ['Structured findings panel', 'Done',
    'Each flag shows the guideline clause, quoted span, confidence bar, plain-English reason and suggestion, with Accept fix (when the fix is literal wording), Edit and Dispute. Agent run details show mode, time, retries and dropped findings.',
    'schemas/finding.schema.json · web/app/review/page.js'],
  ['Role-based review workflow', 'Simplified',
    'Creator → Manager → Approver with server-enforced roles, a state machine, four-eyes (no self-approval), escalation, manual flags, comments, and a queue with score, open flags, change since last revision and age. In-app notifications are on; email is built and switches on with SMTP settings. Sign-in uses seeded demo logins instead of Clerk.',
    'api/src/workflow.js · api/src/auth.js · api/src/notify.js · api/test/rbac.test.js · api/test/workflow.test.js'],
  ['Revision history and audit trail', 'Done',
    'Every AI run is an immutable revision with a word-level diff and compliance delta in the review page. The audit log is append-only and hash-chained; the database rejects edits and deletes, and the chain can be verified, filtered and exported as CSV or JSON.',
    'api/src/audit.js · api/src/diff.js · /audit page'],
  ['ClaimGuard agent', 'Simplified',
    'Detects claim-like sentences and ranks them against the approved claims register (BM25, IDF-weighted coverage, typo-tolerant, with a number-conflict check), citing claim id, source document and page. "No supporting claim" is reported as its own outcome. On 30 annotated texts: precision 0.90, recall 1.00 (0.83 / 0.56 before this upgrade). Embedding retrieval (pgvector) is not built, and a test of character n-gram vectors found they separate supported from unsupported claims worse than this check (20 of 25 correct at best, against 22 of 25), so none is used.',
    'ai/app/retrieval.py · ai/app/agents/claim.py · ai/tests/test_claim_retrieval.py · ai/scripts/eval.py'],
  ['Compliance analytics dashboard', 'Done',
    'Reviews in the last 30 days, average score, average time to approve, AI versus human flags, score trend, violations by agent, content type and creator, and the clauses reviewers keep overriding with their confidence cutoffs. 40 seeded reviews keep it populated.',
    'api/src/routes/governance.js (/analytics/summary) · /dashboard page'],
];

const NAMED = [
  ['Span-level annotation accuracy', 'Done',
    'The model quotes the text and the server computes the offsets, then verifies that the text at each span equals the quote. Mismatches are re-located or dropped, and the dropped count is shown. NFC normalisation avoids offset drift, and a mapping layer converts text offsets to editor positions. Tested with Unicode, repeated phrases and newlines. A before/after number needs the LLM path, which is not enabled on this demo.',
    'ai/app/spans.py · web/lib/spanMap.js · ai/tests/test_pipeline.py · web/test/spanMap.test.mjs'],
  ['Confidence calibration', 'Done',
    'Every flag shows its confidence. Findings below the cutoff are tagged "suggestion" and do not lower the score. Per rule, a high share of disputes and overrides (at least 50% over 5 or more decisions) raises that rule\u2019s cutoff from 60% to 75%, and the dashboard shows the effect. A calibration report (ai/scripts/calibrate.py) compares each agent\u2019s stated confidence with its measured precision on 66 labelled findings; the hand-set values are close, but the sets are small.',
    'api/src/calibration.js · ai/app/pipeline.py · ai/scripts/calibrate.py · api/test/round2.test.js (learning loop)'],
  ['Review latency via parallel streaming', 'Done',
    'Agents run in parallel and each result reaches the page as soon as it is ready. In-process rules mode on a 1,032-word draft: first agent 1 ms median (3 ms max), full review 2 ms median (3 ms max). Queue mode measured 197.1 ms median versus 165.5 ms direct (+31.5 ms) over 10 local runs on a 1,032-word sample expansion with Redis 8.2.10. LLM-mode latency has not been measured yet; the target is a first result under 10 s.',
    'ai/app/pipeline.py (timing) · api streaming route · run details panel'],
];

const DEVIATIONS = [
  ['MongoDB', 'PostgreSQL JSONB', 'One database fewer to deploy; findings and revisions are JSON anyway.'],
  ['Pinecone', 'Not used; ClaimGuard uses lexical retrieval (BM25 + weighted coverage)', 'No external account. We tested character n-gram vectors and they did worse than the current check on our data (ai/scripts/vector_experiment.py), and the claims register is small enough to search in memory, so no vector store is needed. It becomes worthwhile with a neural embedding model or a register of thousands of claims.'],
  ['AWS S3', 'Deferred to Round 3 with VisualGuard', 'Images only matter once VisualGuard exists.'],
  ['Clerk', 'Own JWT auth with seeded demo users', 'Judges can try every role in one click, with no signup. The role model is unchanged.'],
  ['Liveblocks', 'Dropped', 'Not part of the core review workflow.'],
  ['BullMQ + Redis + Socket.IO', 'Optional BullMQ + Redis jobs when REDIS_URL is configured; SSE remains the browser stream. Without REDIS_URL, the direct asyncio pipeline is used.', 'The live demo keeps working without Redis, while deployments that configure Redis can distribute independent agent jobs. Socket.IO remains replaced by server-sent events.'],
  ['Claude 3.5 Sonnet', 'Model-agnostic ToneGuard; basic mode live', 'The live demo runs rule-based tone checks so it costs nothing and cannot hit rate limits. The LLM path is built and switches on with two environment variables.'],
];

export default function About() {
  return (
    <div className="doc">
      <p className="muted" style={{ margin: 0 }}><a href="/">← Home</a> · <a href="/roadmap">Round 3 roadmap</a></p>
      <h1 style={{ marginBottom: 4 }}>What changed since Round 1</h1>
      <p className="muted" style={{ marginTop: 0 }}>Each Round 1 promise, what shipped, and where we simplified or are not done yet.</p>

      <h2>Round 1 MVP, row by row</h2>
      <div className="scroll"><table>
        <thead><tr><th>Round 1 promise</th><th>Status</th><th>What shipped</th><th>Evidence</th></tr></thead>
        <tbody>{MVP.map(([a, s, d, e]) => <tr key={a}><td><b>{a}</b></td><td><Status s={s} /></td><td>{d}</td><td className="muted">{e}</td></tr>)}</tbody>
      </table></div>

      <h2>The three named improvements from Round 1, Week 3</h2>
      <div className="scroll"><table>
        <thead><tr><th>Improvement</th><th>Status</th><th>What shipped</th><th>Evidence</th></tr></thead>
        <tbody>{NAMED.map(([a, s, d, e]) => <tr key={a}><td><b>{a}</b></td><td><Status s={s} /></td><td>{d}</td><td className="muted">{e}</td></tr>)}</tbody>
      </table></div>

      <h2>Deviations from the Round 1 stack, and why</h2>
      <div className="scroll"><table>
        <thead><tr><th>Round 1</th><th>Round 2</th><th>Why</th></tr></thead>
        <tbody>{DEVIATIONS.map(([a, b, c]) => <tr key={a}><td><b>{a}</b></td><td>{b}</td><td>{c}</td></tr>)}</tbody>
      </table></div>
      <p className="muted">Round 1 locked the feature set after submission. No new product features were added; the changes above are infrastructure simplifications. VisualGuard, AccessGuard, multi-brand and drift analytics are not built; see the <a href="/roadmap">Round 3 roadmap</a>.</p>
    </div>
  );
}
