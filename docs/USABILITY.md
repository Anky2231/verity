# Usability and accessibility

Verity is a brand-governance product, so it should meet the standards it checks others against. This page records what was
measured, what was fixed, and what has **not** been done yet. Nothing here is estimated or assumed.

## Status at a glance

| Item | Status |
|---|---|
| Automated accessibility audit (axe-core, WCAG 2.0 and 2.1 A and AA, plus best practices), 11 pages and states in light and dark mode | **Done.** 0 violations after fixes (22 of 22 combinations clean) |
| Keyboard-only run of the creator journey, tab-order check, reflow at 320 px and at 200% zoom | **Done.** 15 of 15 checks pass |
| Lighthouse accessibility on the public pages (`/`, `/about`, `/roadmap`) | **Done.** 100 on each. Pages that need a login were not covered by Lighthouse |
| Usability test with people outside the team | **Not done yet.** Needs real participants. Protocol below; no results are claimed |
| Testing with a real screen reader (VoiceOver, NVDA) | **Not done yet** |

## 1. Automated accessibility audit

**Method.** `web/e2e/a11y.mjs` opens each page in Chrome in light and dark mode, signs in as the right role, and runs
axe-core 4.14 with the rule sets `wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice`. It covers the landing page, About, Roadmap, the
queue (creator and manager), a review with flags, the review page with the reason dialog open, Brand, the extraction preview,
Dashboard and Audit. It exits with an error on any serious or critical finding.

**First run, on the code as it stood after the reason-dialog merge:** 22 serious or critical findings (some pages had several types).

| Finding | Impact | Where |
|---|---|---|
| Colour contrast too low: green text on white was 3.15 to 3.29:1 (needs 4.5:1) | serious | landing, About, queue, review (light mode) |
| Colour contrast too low: white text on the light-blue primary button was 2.48:1 | serious | landing, review (dark mode) |
| The text editor had no accessible name | serious | review |
| `aria-multiline` used without a `textbox` role | critical | review (found while fixing the line above) |
| No `main` landmark on some pages, content outside landmarks | moderate | review, others |
| Empty table header cells | minor | Brand tables, Dashboard table |

**After the fixes:** 0 violations in all 22 page, state and colour-scheme combinations. Re-run with `cd web && npm run a11y`
(stack running).

## 2. Keyboard, tab order and reflow

`web/e2e/keyboard.mjs` (15 checks) drives the creator journey with Tab, Enter, Escape and typed text only: skip link as the first
stop, signing in, "New review", loading the sample, running the review, moving between flags with Previous/Next, disputing a flag in
the reason dialog (focus lands in the text box, Tab reaches Continue), saving, and submitting for approval. It also checks that
no visible control is removed from the tab order and that no page needs horizontal scrolling at 320 px wide or at an effective
200% zoom (640 x 450).

**What that run found and led to fixes:**
- The "+ New review" control was a button inside a link, which gives keyboard users two tab stops and an unreliable Enter key. It is now one link.
- Flags in the side list were clickable boxes that could not be focused. The header of each flag is now a real button, with Previous and Next controls.
- A hidden label I had added to empty table headers stretched the Dashboard to about 600 px wide on a 320 px screen. Found by the reflow check and fixed (the card now clips it).

## 3. Other fixes made in this pass

| Change | Why |
|---|---|
| Severity is shown by underline style as well as colour (dotted low, dashed medium, solid high) with a legend under the editor | Colour alone is not enough (WCAG 1.4.1) |
| The Dashboard score trend also has a "view the same data as a table" section | A chart alone is not available to screen reader users |
| Each page sets its own document title | WCAG 2.4.2: users can tell tabs and pages apart |
| The judge walkthrough bar starts collapsed on screens narrower than 640 px | It covered about a fifth of a phone screen |
| Animations are turned off for users who ask for reduced motion | Respects `prefers-reduced-motion` |

## 4. What is not covered

- **No real user has been observed using Verity.** The scripted checks above prove the markup and keyboard paths work; they do
  not prove the product is clear to a newcomer.
- **No screen reader testing** (VoiceOver, NVDA, TalkBack) has been done. axe finds roughly a third to a half of accessibility
  problems automatically; the rest need a person.
- Lighthouse was run on the three public pages against the development server. The pages that need a sign-in were covered by
  axe only.
- Touch target size (WCAG 2.2) and cognitive-load questions were not audited.

## 5. Usability test protocol (to run with real people)

Recruit **3 people who have never seen Verity**, one of them non-technical, plus one more for a retest after fixes.

**Give each person only this:** "You work at a coffee company. Use this site to check a social post against the brand guidelines,
fix what it flags, and get it approved." Do not explain anything and do not touch the screen. Ask them to think aloud and, with their
permission, record the screen.

**Record for each person:** did they finish, how long it took, where they hesitated or went the wrong way, what they said.

| Participant | Finished? | Time | Where they got stuck | What they said | Severity | Fix and commit |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| Retest | | | | | | |

Report only what actually happened. Fix the problems that two or more people hit first, then retest.
