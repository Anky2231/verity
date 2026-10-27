# Demo video script (2 to 3 minutes)

Record the deployed site, not localhost. Keep the judge walkthrough bar visible: it shows the path.

| Time | Show | Say |
|---|---|---|
| 0:00 | Landing page | "Brand guidelines live in PDFs; content is written everywhere else. Verity turns the guidelines into checks that run before anything is published, and keeps people in charge." |
| 0:15 | Brand page: **Use sample guideline**, preview, edit one rule, publish | "A manager uploads the guideline. Verity extracts rules, approved terms and approved claims with their source pages. Nothing goes live until the manager reviews it, and every publish is a new version." |
| 0:45 | Review page: load sample, run | "Three agents run in parallel and report as they finish: tone, terminology, and claims checked against the approved claims register. Each flag cites the clause, shows confidence, and explains itself." |
| 1:10 | Accept a fix, dispute one with a reason, re-run, show the diff | "The creator fixes or disputes. Disputes need a reason. Re-running shows the score and flag change and a text diff." |
| 1:30 | Switch role to Manager: override, add a manual flag, approve. Switch to Approver: final approve | "Roles are enforced on the server. Managers can override the AI and add flags it missed. Nobody can approve their own content. Publishing is always a human action." |
| 1:55 | Audit page: Verify chain | "Every flag and decision is in an append-only, hash-chained log. Verify it here, or export it." |
| 2:15 | Dashboard | "Managers see where violations come from, and which clauses reviewers keep overriding. Verity learns from that and raises its confidence bar for those clauses." |
| 2:35 | `/roadmap` | "Round 3 is built: image checks, multiple brands, and drift. Every result and its limits are on this page." |
| 2:45 | End card with the URL | |

### Round 3 version (about 3 minutes; replace the rows above after 1:55 if the video must stay short)
| Time | Show | Say |
|---|---|---|
| 0:00 | Header brand switcher as Maya: Lumina (creator), switch to Northwind (manager) | "Agencies work on many brands. One person, different role in each; guidelines, reviews, audit and dashboard all change with the brand." |
| 0:25 | Northwind: load sample, run, point at the **other brand** flag | "Lumina's wording slipped into a Northwind post. Verity flags it, because it knows the writer also works on Lumina." |
| 0:50 | Dashboard: **Create link**, open it in a private window, then revoke | "A client gets a read-only report. No content, no names. It expires and I can revoke it." |
| 1:15 | Lumina: **New image review**, upload a recoloured-logo banner; click a numbered box; dispute with a reason | "VisualGuard checks images against the brand's logos and palette. Every problem is boxed and cites its clause. Same decisions, same approval, same audit." |
| 1:50 | Brand page: palette and logos, the retired logo | "The manager keeps the approved logos, the retired one, and the palette here." |
| 2:10 | Drift page: Social drifting, the chart, the digest | "Single reviews hide slow change. Social has been writing more jargon for four weeks, about double its own baseline. Verity says which clause to expect next." |
| 2:40 | `/roadmap` | "All three are measured against their targets, and the limits are written next to the numbers." |

Say plainly, once: "On this demo, the tone agent runs in basic rules mode; the language-model path is built and switches on with an API key."
