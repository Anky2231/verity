# Task for Sakshi: independent test data for the AI agents

**Why this matters.** Every accuracy number in the project was measured on test data written by the same person who wrote the
detectors, and the image tests are drawn by code, not made by designers. Judges (and Round 3's "stronger technical
implementation") reward numbers that come from data the author did not shape. You can provide that. Your Round 1 role was
AI/ML, and evaluation is the part of this work that is still weakest.

**Rules.** Work on a branch and open a pull request. Write the data **before** you run the agents on it, and do **not** change a
label afterwards to make a number look better; report whatever comes out, including bad results. Do not look at the detector code
while writing the data (it is the point).

## 1. Set up (about 20 minutes)
```bash
git clone https://github.com/Swas00/verity.git && cd verity && git checkout -b feat/independent-eval
cd ai && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q tests/test_claim_patterns.py      # a quick check that it works
```

## 2. Part A: a real-image test set for VisualGuard (the most valuable part)
Make about **30 banners by hand** in Canva, Figma or similar, at roughly 800x450, exported as JPEG or PNG.
- Use the brand's real files: `api/seed/assets/lumina_logo.png` (approved logo), `api/seed/assets/lumina_logo_2019.png` (retired logo). Palette (Lumina): Amber #c77d0a, Roast brown #4b2e1e, Cream #f5ebdd, Charcoal #222222.
- About **8 compliant** banners (only palette colours, approved logo, space around it), and about **22 with exactly one planted problem**: off-palette colour (5), stretched or squashed logo (4), recoloured logo (4), retired logo (4), crowded logo or too close to the edge (5).
- Make them look like real designs: different layouts, photos or textures as backgrounds in a few, text on some, the logo at different sizes. Include a few tricky ones (logo slightly rotated, partly cropped, logo on a photo) and mark them `"hard": true`.
Save images in `ai/eval/visual/real/` and write `ai/eval/visual/real.json` in the same format as `ai/eval/visual/heldout.json`:
```json
{ "file": "real/banner_01.jpg", "kind": "recoloured", "expected": ["v_logo_colour"], "region": {"x": 520, "y": 40, "w": 110, "h": 110} }
```
Rules are `v_palette`, `v_logo_distorted`, `v_logo_colour`, `v_logo_retired`, `v_logo_space`. A compliant image has `"kind": "compliant"`, `"expected": []`, `"region": null`. `region` is the rectangle of the problem in the image's pixels.
Then run (this works with any split name):
```bash
.venv/bin/python scripts/visual_eval.py real
```
Put the output, unedited, in your pull request, with a paragraph saying what failed and why you think so.

## 3. Part B: independent cross-brand text (about 1 hour)
Write about 40 short texts for two brands, **without reading** `ai/app/agents/contamination.py`: half contain wording from the other brand (names, product terms, claims, the other brand's style), half are clean. Use `api/seed/lumina_big.json` and `api/seed/northwind_big.json` to see each brand's terms and claims. Save as `ai/eval/contamination_independent.json` in the same format as `ai/eval/contamination.json` (`id`, `in`, `kind`, `planted`, `expect`, `text`). Make `ai/scripts/contamination_eval.py` accept the file name as an argument (small change, one commit), run it, report the numbers.

## 4. Part C (optional): a fresh ClaimGuard and ToneGuard held-out set
The current held-out set is no longer clean for two ClaimGuard patterns. Write 30 new texts in the format of `ai/eval/heldout.json` (`text` plus `expected: [{agent, quote}]`), save as `ai/eval/heldout2.json`, add `"heldout2": "heldout2.json"` to `SETS` in `ai/scripts/eval.py`, run `.venv/bin/python scripts/eval.py heldout2`, report precision and recall per agent.

## What to hand back
A pull request with the images, the JSON files, the small script changes, and a comment with the exact commands and the unedited output.
Swastik will review it, add your numbers to the README next to the existing ones (clearly labelled as independent), and write your line in
the team table from what your commits contain. A bad result you report honestly is worth more than a good one you tuned.
