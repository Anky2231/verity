# Round 2 form: answers to paste

Each block below is the text for one field. Every statement here is checked against the repository or the live site. Re-read the
"What does NOT work yet" block before pasting: it is deliberately complete.

## Link to the functioning project
https://verity-two-delta.vercel.app

(Put in the notes box if there is one: click **Start judge walkthrough**; no signup. First visit after a quiet period can take up to a minute while the free host wakes; the page says so and continues by itself.)

## Source-code repository
https://github.com/Swas00/verity

## Google Drive link to your updated project PDF
Upload `docs/Verity_Round2_Project.pdf`, set sharing to "Anyone with the link" as Viewer, open the link in a private window, paste it.

## The list of features you completed
One-click demo login for three roles (Creator Maya, Manager Rajan, Approver Anita), no signup
Guideline builder: upload a PDF, DOCX, TXT or MD brand guideline, or use the sample, and extract rules, approved terms, approved claims with source pages and a voice profile
Editable extraction preview with notes on anything unclear, then publish as a new immutable guideline version
Review editor with a highlight on every flagged span, severity shown by colour and underline style, flags that follow the text as it is edited
TermGuard: banned and approved terminology, including singular, plural, hyphen and spacing variants, and allowed contexts
ClaimGuard: finds unsupported product claims, matches them against the approved claims register and cites claim id, source document and page, and flags a wrong number even when the words match
ToneGuard in a labelled basic mode (rule-based: jargon, hype, shouting, pressure wording)
MetaAgent: merges overlapping flags into one result, ranks them, computes a 0 to 100 compliance score
Each flag shows the guideline clause, the quoted text, a confidence bar, a plain-English reason and a suggested fix
Accept fix, edit and dispute actions on each flag; disputing needs a written reason (accessible dialog)
Results stream to the page as each agent finishes
One failing agent never blocks the others; a labelled precomputed result is used for the sample text if the AI service is down
Revision history: every run is an immutable revision, with a word-level diff and the change in flags and score
Approval workflow Creator, Manager, Approver: submit, approve, reject with a reason, escalate, final approval, send back, mark as published
Roles enforced on the server for every route; nobody can approve their own content
Review queue with score, open flags, change since last revision and age
Comments on reviews and in-app notifications
Audit trail: append-only, hash-chained, with a "Verify chain" button, filters, and CSV and JSON export
Compliance dashboard: reviews, average score, time to approve, AI versus human flags, score trend, violations by agent, content type and creator
Learning loop: rules that reviewers keep disputing or overriding get a higher confidence cutoff, and the dashboard marks them as possibly ambiguous
Result cache and rate limiting
Optional BullMQ and Redis job queue (works when REDIS_URL is set, otherwise the direct pipeline runs)
Server-waking message on the landing page so a visitor on the free host knows what is happening
OpenAPI 3.1 reference for all 25 API routes, checked against the code by an automated test
Pagination for the review list and audit trail, request logging with request ids, security headers, input validation
Accessibility work: automated audit with no serious violations in light and dark mode, keyboard-only journey, works at 320 px width and 200% zoom
Roadmap and About pages inside the app (progress since Round 1, Round 3 plan with acceptance tests)

## Technology and implementation details
Three services. Web: Next.js 14 (App Router) and React 18, TipTap/ProseMirror editor with a decoration plugin for the flags, hosted on Vercel. API: Node.js and Express, JWT demo logins with server-side role checks, a review workflow state machine, server-sent events for streaming, a result cache and rate limiter, hosted on Render (free). AI service: Python FastAPI with Pydantic schemas, running the agents in parallel; it runs in the same Render container as the API. Data: PostgreSQL (Neon free tier in production; an in-process Postgres, PGlite, locally and in tests), JSONB for findings and guideline versions, brand_id on every table. Optional BullMQ and Redis for per-agent jobs.
Agents: TermGuard is a deterministic glossary matcher with variant patterns and allowed contexts. ClaimGuard finds claim-like sentences and ranks them against the approved claims register with BM25 and IDF-weighted word coverage plus a number-conflict check. ToneGuard is built to call an LLM with schema-validated output and repair retries; the live demo runs its deterministic basic mode, labelled in the interface and in the audit record. MetaAgent merges overlapping spans, ranks by severity and confidence, and computes the score.
Technically hard parts: (1) Span integrity: models are poor at character offsets, so agents return the quoted text, the server computes and verifies the offsets, re-locates or drops mismatches, and a mapping layer converts text offsets to editor positions (tested with Unicode, repeated phrases and newlines). (2) A tamper-evident audit log: one SQL statement computes each hash from the previous row, a unique constraint stops forks under concurrency, and database triggers reject update, delete and truncate. (3) Confidence calibration from reviewer overrides per rule. (4) Graceful degradation: per-agent isolation, a circuit breaker around the optional queue, and honest labels on every fallback.
Evaluation: two annotated sets of 30 texts (dev and held-out). Held-out now: TermGuard precision 0.83 and recall 1.00, ClaimGuard 0.75 and 1.00, ToneGuard basic mode 0.79 and 1.00. The held-out labels were not changed to improve the numbers. A calibration report compares stated confidence with measured precision. Database indexes were measured on 20,000 generated reviews (first page of a list from 14 ms to 0.07 ms, one review's audit trail from 6.7 ms to 0.01 ms).
Testing: 48 API tests, 62 AI tests, 7 web unit tests, and browser suites (a 37-check full journey, accessibility audit, keyboard-only journey, server-waking simulation), all run by GitHub Actions. Code and documentation were written with help from Claude (Anthropic); the team directed and reviewed the work.

## What changed from your original proposal, and why
Stack changes, all to keep the demo free, reachable without signup, and reliable: PostgreSQL JSONB instead of MongoDB (one database fewer, findings are JSON anyway); no Pinecone, ClaimGuard uses lexical retrieval (we tested character n-gram vectors and they separated supported from unsupported claims worse than the current check, so we did not add a vector store); our own JWT auth with seeded demo users instead of Clerk, so judges can try every role in one click; server-sent events instead of Socket.IO; Liveblocks dropped (not part of the core workflow); AWS S3 deferred to Round 3 because it only matters once VisualGuard exists; BullMQ and Redis kept but optional, with a direct pipeline as the default; ToneGuard runs in a rule-based basic mode on the live demo instead of calling Claude, so it costs nothing and cannot hit rate limits (the LLM path is built and switches on with two environment variables). Guideline extraction is rule-based rather than LLM-based. Hosting is on free tiers (Vercel, Render, Neon). Added since Round 1 and not in the original proposal: an in-app server-waking message, an OpenAPI reference with a contract test, pagination, measured database indexes, request logging and security headers, and an accessibility pass. No new product features were added beyond the Round 1 feature set.

## What does NOT work yet
ToneGuard on the live demo is rule-based basic mode, not the LLM, so it catches jargon, hype, shouting and pressure wording but not subtle voice problems. The LLM path is built but not enabled and its latency has not been measured.
Free hosting: after about 15 minutes idle the API sleeps and the first visit takes about 30 seconds to a minute. The landing page says so and continues by itself.
The demo data is shared: every visitor sees the same reviews, and changes by other judges are visible.
Known detection errors: ClaimGuard flags "only" in "Limited time only" and "best" in "best-in-class" as claims (two false positives on the held-out set), and TermGuard flags "Java" meaning the language and "Joe's Diner" unless the brand lists them as allowed contexts; the sample brand does not. Evaluation sets are small (30 texts each) and written by the team.
Guideline extraction is rule-based: unusual document layouts can be missed, and scanned (image-only) PDFs are not read.
Email notifications are built but off (in-app notifications work).
The result cache and rate limiter are per server process.
Sign-in is demo logins only; there is no real account system.
Dashboard summary queries read every review; they take roughly 50 to 90 ms at 20,000 reviews and have not been optimised further.
No usability test with outside people and no screen-reader (VoiceOver, NVDA) testing has been done; automated accessibility checks and a keyboard-only run have.
Not built yet (Round 3): VisualGuard (image and logo checks), multi-brand workspaces, Brand Drift Intelligence, tone embeddings.
Nothing else known.

## Improvement 1
VisualGuard, image and logo compliance. Today Verity reads only words, so a wrong logo version, an off-palette colour or a stretched logo gets through. A creator will upload a banner and see the same kind of flag on the image, with the guideline clause and a suggested fix, before it reaches a manager. Approach: embeddings of approved logos and images compared by similarity against thresholds, a palette check by colour quantisation against the brand palette, and logo clear-space and misuse checks. It reuses the existing finding format (with a region on the image), so the findings panel and scoring need no changes. Acceptance test: at least 85% recall of planted visual violations on a 30-image test set, with at most 10% false flags on compliant images. Groundwork already in the repo: the brand_assets table, a role-guarded upload route, and a region field on findings.

## Improvement 2
Multi-brand workspaces (agency mode). Agencies manage many brands, and mixing one client's guidelines into another's content is a real risk. A manager will switch between client brands, each with its own guidelines, reviews and analytics, and send a client a read-only compliance report link. Approach: brand switcher, per-brand isolation of guidelines, workflow and analytics, per-brand role memberships, a detector that flags one brand's tone in another brand's content, and a shareable read-only report. Acceptance test: automated cross-brand access tests prove a user in Brand A can never read or change Brand B data, and the contamination detector flags at least 80% of planted cross-brand samples. Groundwork already in the repo: brand_id on every table, queries already scoped by brand, and a second brand in the seed data.

## Improvement 3
Brand Drift Intelligence. Teams drift away from guidelines slowly, and single reviews hide the pattern until it is a problem. A brand manager will see which teams and clauses are drifting over time and get an alert before violations pile up. Approach: rolling-window analysis of tone embeddings against the brand's centroid, a per-team drift score with a threshold alert, likely violations predicted from historical patterns, and a weekly digest. Acceptance test: on a seeded history with a planted drift, the alert fires within one window of the drift starting, and does not fire on a stable control series. Groundwork already in the repo: every revision is stored with its timestamp, score and findings, 40 seeded historical reviews, and the override-rate analysis that already marks ambiguous clauses. Tone embeddings and the trend alerts are not built yet.
