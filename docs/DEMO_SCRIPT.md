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
| 2:35 | `/roadmap` | "Next: VisualGuard for images and logos, multi-brand workspaces for agencies, and Brand Drift Intelligence." |
| 2:50 | End card with the URL | |

Say plainly, once: "On this demo, the tone agent runs in basic rules mode; the language-model path is built and switches on with an API key."
