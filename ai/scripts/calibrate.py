"""Calibration report: is a finding's confidence a fair estimate of how often it is right?

Runs the agents over the dev and held-out sets, labels each finding true or false against the annotations, and
reports precision per agent, rule and confidence value, plus how far the stated confidence is from the measured
precision. It only reports; it never changes a cutoff. Small groups are marked as too small to trust.

Run: .venv/bin/python scripts/calibrate.py [--json calibration_report.json]
"""
import asyncio
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.pipeline import review  # noqa: E402
from app.sample_brand import SAMPLE_BIG  # noqa: E402

EVAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "eval")
MIN_N = 8            # fewer labelled findings than this and the precision is not worth trusting
TARGET = 0.80        # precision a violation should reach before it is allowed to cost points
overlap = lambda a, b: a.lower() in b.lower() or b.lower() in a.lower()  # noqa: E731

rows = []   # (agent, rule_id, confidence, correct, set)
for name, fn in (("dev", "dataset.json"), ("heldout", "heldout.json")):
    for item in json.load(open(os.path.join(EVAL, fn))):
        res = asyncio.run(review(item["text"], SAMPLE_BIG))
        exp = [(e["agent"], e["quote"]) for e in item["expected"]]
        for h in res["highlights"]:
            for f in h["findings"]:
                ok = any(a == f["agent"] and overlap(f["quoted_text"], q) for a, q in exp)
                rows.append((f["agent"], f["rule_id"], round(f["confidence"], 2), ok, name))

groups = defaultdict(list)
for agent, rule, conf, ok, _ in rows:
    groups[(agent, rule, conf)].append(ok)

print(f"{len(rows)} labelled findings (dev and held-out sets)\n")
print(f"{'agent':<6}{'rule':<12}{'stated conf':>12}{'n':>5}{'correct':>9}{'precision':>11}{'gap':>8}  note")
report = []
for (agent, rule, conf), oks in sorted(groups.items()):
    n, c = len(oks), sum(oks)
    prec = c / n
    note = "too few to trust" if n < MIN_N else ("over-confident" if conf - prec > 0.1 else ("under-confident" if prec - conf > 0.1 else "fair"))
    print(f"{agent:<6}{rule:<12}{conf:>12.2f}{n:>5}{c:>9}{prec:>11.2f}{conf - prec:>+8.2f}  {note}")
    report.append({"agent": agent, "rule_id": rule, "confidence": conf, "n": n, "correct": c, "precision": round(prec, 3), "note": note})

print("\nPer agent (all rules):")
for agent in ("term", "claim", "tone"):
    sel = [r for r in rows if r[0] == agent]
    if not sel:
        continue
    prec = sum(r[3] for r in sel) / len(sel)
    mean_conf = sum(r[2] for r in sel) / len(sel)
    verdict = "reaches" if prec >= TARGET else "is below"
    print(f"  {agent:<6} n={len(sel):<3} mean stated confidence {mean_conf:.2f}, measured precision {prec:.2f} ({verdict} the {TARGET:.0%} target)")

print("\nCaveat: the confidences are fixed numbers set by hand, not model scores, and the annotated sets are small and written by")
print("the team. Treat this as a check on the values, not as proof. Real calibration needs the LLM path and a larger labelled set.")
if "--json" in sys.argv:
    out = sys.argv[sys.argv.index("--json") + 1]
    json.dump(report, open(out, "w"), indent=2)
