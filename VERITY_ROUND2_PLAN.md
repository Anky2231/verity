# Verity — Round 2 Winning Plan (Team Merge Conflicts)

Goal: score high on all 5 criteria (100 pts) so we qualify for Round 3.
Rule of thumb: **a judge opens the link, clicks around for 5–10 minutes, with nobody explaining anything. Everything below serves that moment.**

---

## 0. The 5 criteria → what we must visibly deliver

| Criterion | Pts | What judges must SEE | Where we prove it |
|---|---|---|---|
| Working core workflow | 30 | Upload guidelines → submit content → agents flag inline → creator fixes → manager approves → approver signs off → audit trail. **No dead buttons, no crashes.** | Live link, one-click demo logins, seeded data |
| Technical depth & reliability | 25 | Real parallel agents (not one LLM call), structured JSON + schema validation + retry, span-accurate highlights, RAG claims with citations, queue, streaming progress, RBAC enforced on the API | Live "Agent run" panel, README architecture diagram, `/health`, audit export |
| Progress from Round 1 | 20 | Side-by-side: "R1 promised X → R2 delivered X". Be honest about what was simplified and why | "What changed since Round 1" table in submission + in-app `/about` page |
| Three planned improvements | 15 | VisualGuard, Multi-Brand, Brand Drift — each with design, data model, acceptance test, and *evidence we already started* | Roadmap section + `/roadmap` page + schema already multi-brand ready |
| Usability | 10 | Zero-signup access, guided "Judge Walkthrough", sample guideline + sample content pre-loaded, clear empty states | Login-as buttons, 5-step checklist banner, tooltips |

**The 3 things that lose rounds:** (1) the link is down / cold-starting / needs signup, (2) the AI call fails or is slow with no fallback, (3) an empty dashboard because there's no data. Sections 3 and 6 are designed to kill these.

---

## 1. Scope decision (the most important call)

Round 1 stack is large (Next.js, Express, FastAPI, BullMQ/Redis, Postgres, Mongo, Pinecone, S3, Clerk, Socket.IO, Liveblocks). Five moving services deployed by judges' deadline is the #1 risk to the 30-pt workflow score. Recommended **"lean but faithful"** build — same architecture story, fewer failure points:

| R1 plan | R2 build | Why (say this in the submission) |
|---|---|---|
| Next.js 14 + TipTap + Tailwind + shadcn | **Keep** | Core UX; unchanged |
| Node/Express gateway | **Keep** (auth, RBAC, workflow, Socket.IO/SSE) | RBAC must be enforced server-side — this is a stated R1 promise |
| FastAPI AI service + LangChain | **Keep** (agent runner, BIG builder, ClaimGuard RAG) | Technical depth points |
| BullMQ + Redis | **Keep** (one queue, one job per agent) | Proves "parallel, non-blocking" claim |
| PostgreSQL | **Keep** — also holds JSONB findings | Replaces MongoDB |
| MongoDB | **Drop → Postgres JSONB** | One DB less to deploy; revision diffs/findings are JSON anyway |
| Pinecone | **Drop → pgvector** (same Postgres) | Namespacing = `org_id/brand_id` column; no external account |
| AWS S3 | **Drop → Postgres bytea / platform storage** (S3 in R3 with VisualGuard) | Images only matter in R3 |
| Clerk | **Replace → own JWT auth + seeded demo users** | Judges must not sign up; Clerk adds friction and config risk. Keep role model identical (Creator/Manager/Approver/Admin) |
| Liveblocks | **Drop** | Not in the core workflow; realtime = progress streaming only |
| Claude 3.5 Sonnet | **Use a current Claude model** (check current IDs; use a fast/cheap one for Tone/Term, stronger one for Claim/Meta) | 3.5 Sonnet is old; latency + cost matter |
| Sentence-Transformers | **Keep if memory fits; else hosted embeddings** | Railway small instances can OOM on torch — test early (Day 1) |

Keep a "Deviations from Round 1" table in the submission. Judges reward *justified* simplification more than a broken full stack. R1's "feature lock" is respected: no new features, only simplified infrastructure.

**Must-haves (cut nothing here):** BIG builder, ToneGuard, TermGuard, ClaimGuard, MetaAgent, inline TipTap flags, findings panel, 3-tier workflow, revision history + audit log, compliance dashboard (even basic).
**Do NOT build in R2:** VisualGuard, AccessGuard, Multi-brand UI, CMS webhooks, Drift ML. Only lay *groundwork* (Section 5).

---

## 2. Detailed product workflow to implement (end-to-end)

### Actors & demo accounts (seeded; shown as one-click buttons on the login page)
- `maya@demo` — Creator · `rajan@demo` — Manager · `anita@demo` — Brand Approver · `admin@demo` — Admin
- Login page: **"Try as Creator / Manager / Approver"** buttons. No passwords to type, no email verification.

### Flow A — Brand onboarding (Manager/Admin)
1. Manager opens **Brand → Guidelines → Upload** (PDF/DOCX). Also a **"Use sample brand guideline"** button (a fictional brand, "Lumina Coffee Co.").
2. Backend extracts text → LLM produces structured **BIG**: `rules[]` (id, clause ref, text, type, scope, severity), `tone_profile` (descriptors + example sentences + embedding), `glossary[]` (approved term, banned variants, reason), `claims[]` (approved claim text, source doc, page).
3. **Extraction preview screen**: manager can edit/delete/add any rule before "Publish BIG". (R1 promised this as a risk mitigation — build it.)
4. Publishing creates **BIG version N** (old versions kept). Store embeddings in pgvector.

### Flow B — Creator submits content
1. Creator opens **New Review** → TipTap editor. **"Load sample content"** button inserts text with deliberate violations (tone slip, banned terms, an unapproved claim like "best coffee in the world").
2. Select content type (blog / social / email) → **Run Verity review**.
3. UI shows a live **agent progress panel**: ToneGuard ⏳ → ✅ (5 findings), TermGuard ✅, ClaimGuard ⏳… (streamed via Socket.IO/SSE, partial results appear as each agent finishes).

### Flow C — Multi-agent review (backend)
1. Gateway creates `review` + `revision` row, enqueues **3 BullMQ jobs** (Tone, Term, Claim) with `{revision_id, brand_id, big_version, text}`.
2. FastAPI worker per agent: builds prompt with *only relevant BIG entities* (retrieval by type/scope/embedding), calls Claude with **structured output** (Pydantic schema), validates, retries ≤3 with repair prompt + backoff.
3. Finding schema (every agent): `{agent, rule_id, clause_citation, span:{start,end}, quoted_text, confidence, severity, explanation, suggestion}`.
4. **Span verification**: after the LLM returns, server checks `text[start:end] == quoted_text`; if not, re-locate via fuzzy search, else drop with a log. (This is your "span accuracy" improvement — make it a visible feature.)
5. **MetaAgent**: interval-merge overlapping spans, combine reasons, rank by brand-configured severity weights, compute **compliance score** (0–100) + short reasoning summary.
6. Low-confidence (< 0.6) findings tagged "suggestion", not "violation".
7. A failed/timed-out agent → review still completes with a visible "ClaimGuard unavailable — retry" chip (never a blank screen).

### Flow D — Creator resolves flags
- Inline highlights colored by agent; click → side panel: clause cited, confidence bar, explanation, suggested fix.
- Actions per flag: **Accept** (applies replacement in editor), **Edit**, **Dispute** (requires reason).
- **Re-run review** → creates revision N+1; show **compliance delta** (e.g. 9 flags → 2) and a text diff.
- **Submit for approval** (disabled until a review exists; tooltip explains why).

### Flow E — Manager queue
- Queue table: title, creator, score, open flags, delta, age; filter by status.
- Open item → see highlights, creator's accepts/disputes with reasons, revision diff.
- Actions: **Approve · Comment · Reject (reason required) · Escalate to Approver**. Manager can also **add a manual flag** (selecting text) — feeds learning.
- Overriding an AI flag requires a reason.

### Flow F — Approver sign-off & export
- Approver sees escalated items only; **Final approve / Send back**.
- Approved → status "Approved" + export (copy / .md / .docx or JSON). **No auto-publish** (R1 promise): button says "Mark as published" and is a human action.
- Review report carries **"Reviewed by Verity AI · model · BIG v3"** label.

### Flow G — Audit trail & learning
- Append-only `audit_log` (DB trigger/permissions block UPDATE/DELETE): every AI flag, accept/dispute/override, status change, with actor, timestamp, reason, hashes. **Export JSON/CSV** button.
- Learning loop (simple, real): per brand + agent + rule, keep `override_rate`. If a rule's override rate > threshold over ≥N decisions, raise the confidence cutoff for that rule and flag it "ambiguous" in analytics. Show the effect on the dashboard (this is also "confidence calibration").

### Flow H — Compliance dashboard
- Cards: reviews this period, avg score, avg time to approve, AI vs human flags.
- Charts: violations by agent / content type / creator; **top ambiguous clauses** (high override rate); score trend.
- **Seed 30–60 historical reviews** so charts are populated on first open.

---

## 3. "Judges use it without help" — usability checklist
- [ ] Public URL, **no signup**, no VPN, works on Chrome/Safari/mobile width.
- [ ] Landing page: 2-line pitch + **"Start judge walkthrough"** + login-as buttons.
- [ ] Persistent walkthrough bar: ① Upload sample guideline ② Review sample content ③ Fix flags ④ Approve as Manager ⑤ See audit & analytics. Each step links to the right screen and ticks itself.
- [ ] Pre-seeded: brand + BIG v1, 3 drafts in different states, queue items, audit entries.
- [ ] Every empty state has a CTA ("No reviews yet → Load sample content").
- [ ] Loading skeletons, error toasts with retry, no raw stack traces.
- [ ] Short tooltips on confidence, severity, delta.
- [ ] Role badge always visible; "Switch role" menu in header (fast demo of RBAC).
- [ ] Keyboard-accessible, contrast OK (it's a brand/accessibility product — dogfood it).

---

## 4. Technical depth & reliability checklist (25 pts)
- [ ] 3 agents as **independent queue jobs**; kill one in a test and show review still completes.
- [ ] Pydantic-validated structured output; retry-with-repair; counters visible in an **"Agent run details"** drawer (latency, tokens, retries, model).
- [ ] ClaimGuard: RAG over approved claims (pgvector), **every flag cites claim id + source doc/page**; "no supporting claim found" is a distinct, explainable outcome.
- [ ] Span verification (Flow C.4) + unit tests with tricky text (unicode, repeated phrases, newlines).
- [ ] Interval-merge dedup in MetaAgent + unit tests.
- [ ] RBAC middleware server-side; test: Creator token → manager endpoint = 403. Include this in a visible **`/api/health` + test suite badge**.
- [ ] Prompt-injection guard: content is passed as delimited data; a sample "ignore previous instructions" content is in the seed set and gets handled (flagged), not obeyed.
- [ ] Rate limit + **cache reviews by (content hash, BIG version)** → repeat demo clicks are instant and cheap.
- [ ] **Fallback mode**: if the LLM API errors/rate-limits, serve a pre-computed result for the *sample* content (clearly labelled "cached demo result") so judges never see a dead product. Never silently fake real user content.
- [ ] Cold starts: use an always-on plan or a keep-alive ping; test the URL after 1 hour idle.
- [ ] Secrets in env vars only; spend cap on the LLM key; CI runs lint + tests + `npm audit`/`pip-audit`.
- [ ] Latency target: first agent result < 10 s, full review < 60 s for ~1,000 words. Measure and show in README.
- [ ] Small eval: 15–20 annotated sample texts → report precision/recall for Tone/Term in README (even rough numbers beat none).

---

## 5. "Progress from Round 1" (20 pts) & "Three planned improvements" (15 pts)

### 5a. Progress table (put in submission AND `/about`)
Columns: *R1 promise → R2 status (✅ Done / 🟡 Simplified / ⏭ Planned R3) → Evidence (screen/link/commit)*. Cover every row of the R1 MVP table plus the three "named improvements" from R1 Week 3: span accuracy, confidence calibration, parallel streaming latency — show each with a before/after number or screenshot.
Also list the Deviations table (Section 1) honestly. Add a commit-history/PR link; keep commits regular and meaningful.

### 5b. The three Round 3 improvements — make each "substantial and useful"
For each: *problem it solves · user story · technical design · data model · acceptance test · effort/owner · what's already built*.

1. **VisualGuard (image/logo compliance)** — CLIP embeddings of approved logos/images; cosine-sim thresholds; palette check via color quantization vs brand palette; logo clear-space/misuse detection; output uses the same Finding schema so the existing panel/MetaAgent work unchanged. *Groundwork in R2:* `brand_assets` table, asset-upload endpoint stub, "Visual" agent slot in the progress panel (shows "Coming in Round 3"), finding schema already supports `region` (bbox) in addition to text span.
2. **Multi-Brand Workspaces (agency mode)** — brand switcher, isolated BIG/workflow/analytics per brand, per-brand role memberships, cross-brand-contamination detector ("Brand A tone in Brand B content"), shareable read-only compliance report link for clients. *Groundwork in R2:* **every table already has `brand_id`**; all queries scoped by it; seed includes a 2nd brand so the switch is trivially demoable later.
3. **Brand Drift Intelligence** — rolling-window analysis of tone embeddings vs. the brand centroid, per-team drift score, alert when drift crosses threshold, "predicted likely violations" from historical patterns, weekly digest. *Groundwork in R2:* we already store per-revision tone embeddings + timestamps; dashboard already has a score-trend chart that Drift extends.

Optionally add a 4th "stretch" line, but keep exactly **three** as the named improvements. Show the acceptance criteria as measurable (e.g. "Visual violation recall ≥ 85% on 30-image test set").

---

## 6. Week-by-week execution plan (adjust to the real deadline)

> Check the exact Round 2 deadline and subtract 1 day as buffer for submission + 1 day for a freeze/test. Below assumes ~3 weeks.

### Day 0 (today) — set the rails (everyone)
- Create repo (monorepo: `/web`, `/api`, `/ai`), branch protection, CI (lint+test), `.env.example`.
- **Contracts first**: write OpenAPI for the gateway + the Finding/BIG JSON schemas in a shared `/schemas` folder. This lets all 5 work in parallel.
- Deploy a "hello world" of all three services **today**. Deployment problems found on Day 0 cost nothing; on Day 18 they cost the round.
- Pick the LLM model IDs; confirm API key, rate limits, spend cap.

### Week 1 — Foundation (target: vertical slice by Day 5)
| Owner | Tasks |
|---|---|
| Swastik | Gateway skeleton, JWT auth + demo users, RBAC middleware, BullMQ setup, Socket.IO events; TipTap editor + flag-mark extension (spans → highlights) |
| Akriti | Postgres schema (users, orgs, brands, big_versions, rules, reviews, revisions, findings JSONB, comments, audit_log append-only, brand_id everywhere) + migrations + seed script; workflow endpoints |
| Gayathri | Design system, login page w/ role buttons, editor screen, findings panel, agent progress panel, walkthrough bar |
| Sakshi | ToneGuard + TermGuard prompts, Pydantic schemas, retry/repair, embeddings pipeline, eval set (first 10 samples) |
| Shivam | FastAPI service + worker, Redis, deploy pipeline (Vercel + Railway), env/secrets, health checks, logging |
**Milestone D5:** paste sample text → Tone+Term findings highlight in editor on the deployed URL.

### Week 2 — Core workflow (target: whole journey works by Day 12)
- BIG builder + extraction preview/edit + versioning (Sakshi + Swastik; UI Gayathri).
- ClaimGuard RAG with citations (Swastik/Sakshi). MetaAgent merge + score (Sakshi).
- Creator actions (accept/edit/dispute), re-run, revision diff, compliance delta (Gayathri + Akriti).
- Manager queue, approve/reject/escalate, Approver sign-off, email (or in-app) notifications (Akriti + Shivam). *If email setup is risky, in-app notifications + one real email provider is enough.*
- Audit trail + export; learning-loop counters (Akriti/Swastik).
**Milestone D12:** a stranger can complete the full A→G journey on the live link. **Feature freeze.**

### Week 3 — Reliability, three named improvements, polish
- Span-verification, confidence calibration w/ override rates, partial-result streaming (< 10 s first result) — with before/after numbers.
- Dashboard + seed data (30–60 historical reviews); ambiguity detector.
- Fallback mode, caching, rate limiting, prompt-injection sample, cold-start fix.
- Round 3 groundwork (Section 5b), `/roadmap` and `/about` pages.
- Run the eval, fix top failures, write tests (RBAC, span, merge, workflow state machine, 1 Playwright happy-path).
- **Usability test:** have 2–3 non-team people use the link with zero guidance; fix every confusion (Gayathri leads).

### Final 48 hours — freeze & submit
- Day −2: code freeze (bug fixes only). Fresh-browser/incognito + phone test of the full journey. Test after idle (cold start).
- Day −1: record the **2–3 min demo video** (script below), finalize README/submission, double-check links open logged-out, check API spend cap/credits.
- Day 0: submit early; re-open every link from a different device/network.

---

## 7. Submission package (don't miss any piece)
1. **Live URL** (+ note: "no signup — use the role buttons"). Mention working browsers.
2. **Demo credentials** (even if one-click) written in the submission.
3. **Public GitHub repo** with README: what/why, architecture diagram, setup steps, env vars, agent descriptions, how to run tests, eval numbers, known limitations, AI-use disclosure (as promised in R1 declaration), licences.
4. **Demo video 2–3 min**, hosted link (works without login). Script: 15 s problem → 30 s upload guideline/BIG → 60 s review + inline fix → 30 s manager/approver + audit → 15 s dashboard → 20 s Round 3 roadmap.
5. **Progress-from-Round-1 table** + deviations (Section 5a).
6. **Three Round 3 improvements** write-up (Section 5b).
7. **Architecture diagram** (1 image) and a **"known limitations"** paragraph — honesty reads as maturity.
8. Team contribution table (matches R1 names exactly).
9. Any required form fields from the organizers — re-read the Round 2 brief right before submitting.

---

## 8. Risk register (top items)
| Risk | Mitigation |
|---|---|
| Deployment fails late | Deploy skeleton Day 0; deploy daily; CI auto-deploys main |
| LLM outage / rate limit / cost spike | Retry+backoff, cache by content hash, labelled cached sample result, spend cap, 2nd model fallback |
| Slow reviews | Fast model for Tone/Term, stream per-agent, trim BIG context to relevant entities |
| Span highlights misaligned | Verify `text[start:end]` server-side; add tests; normalise whitespace/unicode once at ingestion |
| Embedding model OOM on host | Test Day 1; fall back to hosted embeddings |
| Empty/boring demo | Seed data, sample buttons, walkthrough bar |
| Scope creep | Section 1 "do NOT build" list; every PR must map to a checklist line |
| Integration chaos | Contracts-first (Day 0), daily 15-min sync, one integration branch owner (Swastik) |
| Judge can't log in | Role buttons; no passwords/verification; test logged-out |

---

## 9. Final pre-submission QA script (run it yourselves, incognito)
1. Open URL cold → loads < 5 s, no login wall.
2. Login as Manager → use sample guideline → preview → publish BIG.
3. Login as Creator → load sample content → run review → partial results stream in → highlights align with text.
4. Accept 2 flags, dispute 1 (reason), re-run → delta shown, diff shown.
5. Submit → login as Manager → see in queue → approve/escalate → login as Approver → final approve.
6. Open audit trail → export JSON/CSV → entries for every step above.
7. Dashboard shows populated charts + ambiguous clauses.
8. Creator token hitting manager API via curl → 403.
9. Kill the Claim agent (or simulate failure) → review still completes with visible notice.
10. Repeat on phone width and in Safari.
All 10 pass → submit.
