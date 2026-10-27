# QA script (run before every submission freeze)

Run on a **fresh browser profile** and then on a **phone**, against the deployed URL. Tick each line.

## Judge path (about 5 minutes, zero guidance)
- [ ] Landing page loads; "API" and "AI service" badges show `up`.
- [ ] **Start judge walkthrough** signs in as Manager and opens Brand guidelines. The bottom bar shows 5 steps.
- [ ] **Use sample guideline** shows 3 rules, 3 terms, 3 claims. Edit one rule, **Publish as new version**. Step 1 ticks.
- [ ] Upload `web/public/sample/lumina-brand-guidelines.pdf` and the `.docx`: both extract the same counts. Upload a `.exe` or an empty file: a plain-English error, no crash.
- [ ] Step 2: **Load sample content**, **Run Verity review**. Agent chips fill in one by one; highlights line up with the words.
- [ ] Click each flag: clause, confidence bar, explanation, suggestion. **Accept fix** changes the right words; flags with no replacement have Accept disabled with a tooltip.
- [ ] **Dispute** asks for a reason. **Edit** selects the flagged text.
- [ ] **Re-run review**: score and flag delta appear; **Compare revisions** shows additions and deletions.
- [ ] **Submit for approval** (disabled with a tooltip until a review exists). The text locks.
- [ ] **Load prompt-injection test** and run: the "ignore previous instructions" text is flagged, not obeyed.
- [ ] Manager: queue shows score, flags, Δ and age. Open the review, **Override** a flag (reason required), **Flag selected text**, comment, **Approve**. Creator's bell shows the approval.
- [ ] **Export**: Copy, .md and .json work. **Mark as published** is a button press, never automatic.
- [ ] Escalate a submitted review as Manager; as Approver, **Final approve** and **Send back** (reason required).
- [ ] Dashboard: cards, score trend, bars, and the ambiguous-clause table are populated.
- [ ] Audit: **Verify chain** says intact; CSV and JSON export; filter by review.
- [ ] Creator opening `/audit`, `/dashboard` or `/brand` sees a polite "not for your role" message. Creator calling a manager API gets 403.

## Round 3 path (about 8 minutes)
- [ ] **Brands.** As Maya the header shows "Brand: Lumina Coffee Co." and role `creator`. Open the switcher: Lumina (creator) and Northwind (manager). Switch: the page reloads, the role badge says `manager`, the queue shows only Northwind reviews, and a Dashboard link appears.
- [ ] **Other brand.** At Northwind, **New review**, load the sample, run it. Among the flags one is labelled **other brand** (Lumina's "coffee beans" or its 48-hour claim).
- [ ] **Client report.** As Maya at Northwind, Dashboard, **Create link**. Copy the link, open it in a private window: "Compliance report: Northwind Tea Co." with scores and review titles, no names and no review text. Back in the dashboard, **Revoke**; reload the private window: "This report link is not valid".
- [ ] **Image review.** As Maya at Lumina, **New image review**, upload `ai/eval/visual/heldout/` files (for example a `recoloured` one). Numbered boxes appear on the image; each problem names its clause (Visual §2.2 and so on). **Dispute** asks for a reason. Upload a `compliant` image as a new version: "No problems found". **Submit for approval**, then as Rajan open it from the queue and **Approve**.
- [ ] **Brand assets.** As Rajan on **Brand**: the four palette colours and two Lumina logos (current and 2019, labelled Retired) show as pictures. Add a colour and remove it. A creator cannot see this section.
- [ ] **Second brand's assets.** At Northwind the palette is green, and a Lumina image uploaded there is flagged **Colour palette**.
- [ ] **Drift.** As Rajan, **Drift**: Social is **Drifting** (about 2 times its baseline, clause Voice §1.2), Email, Blog and Content are Stable. The digest names Social; the bell has a drift alert once, and reloading does not add another. "View the same data as a table" shows the numbers behind each chart.
- [ ] **Queue.** The queue shows 25 reviews and "Load more"; searching "newsletter" narrows it; search and status filter combine.

## Reliability
- [ ] Phone width (375 px): no horizontal page scroll on `/`, `/queue`, `/review`, `/brand`, `/dashboard`, `/audit`, `/about`, `/roadmap`, `/visual`, `/drift`.
- [ ] Stop the AI service: run the **sample** content (labelled "cached demo result") and other content (clear error with Retry). Never a blank screen.
- [ ] Click **Run** 25 times quickly: a friendly rate-limit message appears.
- [ ] Run identical content twice: the second is instant and labelled "cached result".
- [ ] **Cold start:** leave the deployment idle for at least 30 minutes, then open the live URL. Free hosting can take about 30 seconds to wake: the landing page must show "Waking up the server", and clicking a role must sign you in by itself once the server is ready, with no error and no blank screen.
- [ ] Keyboard only: Tab reaches every button, focus ring visible, Escape/Tab leave menus.

## Before submitting
- [ ] Every link in the submission opens logged out, from another device and network.
- [ ] LLM key (if used) has a spend cap and credit.
- [ ] README setup steps work from a clean clone.
