"""Measures VisualGuard on the committed test sets (eval/visual/dev.json, heldout.json).

  .venv/bin/python scripts/visual_eval.py [dev|heldout|both]

Recall: violation images where the expected rule was reported AND its box overlaps the planted violation.
False flags: compliant images with any finding at all. Wrong flags: other rules reported on violation images.
Dev is for tuning thresholds; held-out is never used for tuning, so it is the number to trust."""
import json
import pathlib
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.visual import agent  # noqa: E402

EVAL = ROOT / "eval" / "visual"


def assets():
    def logo(name):
        return np.array(Image.open(EVAL / "assets" / name).convert("RGBA"))
    return {"palette": json.loads((EVAL / "assets" / "palette.json").read_text()),
            "logos": [{"id": "logo", "name": "Lumina logo", "rgba": logo("lumina_logo.png")}],
            "retired_logos": [{"id": "old", "name": "2019 Lumina logo", "rgba": logo("lumina_logo_2019.png")}]}


def overlaps(a: dict, b: dict, need: float = 0.5) -> bool:
    """The reported box covers at least `need` of the smaller of the two boxes."""
    x0, y0 = max(a["x"], b["x"]), max(a["y"], b["y"])
    x1, y1 = min(a["x"] + a["w"], b["x"] + b["w"]), min(a["y"] + a["h"], b["y"] + b["h"])
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    return inter >= need * min(a["w"] * a["h"], b["w"] * b["h"])


def evaluate(split: str, verbose: bool = True):
    labels = json.loads((EVAL / f"{split}.json").read_text())
    ast = assets()
    by_kind: dict[str, list[int]] = {}
    clean_total = clean_false = viol_total = viol_hit = wrong = 0
    misses, falses, extras = [], [], []
    for lab in labels:
        img, _, _ = agent.decode_image((EVAL / lab["file"]).read_bytes())
        found = agent.review_image(img, ast)
        rules = {f.rule_id for f in found}
        if not lab["expected"]:
            clean_total += 1
            if found:
                clean_false += 1
                falses.append((lab["file"], sorted(rules)))
            continue
        viol_total += 1
        want = lab["expected"][0]
        # the label's coordinates are in the stored image; decode_image only shrinks above 1600 px, which these never reach
        hit = any(f.rule_id == want and overlaps(f.region, lab["region"]) for f in found)
        viol_hit += hit
        wrong += len(rules - {want})
        if rules - {want}:
            extras.append((lab["file"], sorted(rules - {want})))
        k = by_kind.setdefault(lab["kind"], [0, 0]); k[1] += 1; k[0] += hit
        if not hit:
            misses.append((lab["file"], want, sorted(rules)))
    if verbose:
        print(f"\n[{split}] {len(labels)} images: {viol_total} with one planted violation, {clean_total} compliant")
        print(f"  violations found with the right rule and a box on the right place: {viol_hit}/{viol_total} = {viol_hit / viol_total:.0%}")
        for kind, (c, n) in sorted(by_kind.items()):
            print(f"    {kind:11s} {c}/{n}")
        print(f"  compliant images wrongly flagged: {clean_false}/{clean_total} = {clean_false / clean_total:.0%}")
        print(f"  other (unexpected) rules reported on violation images: {wrong}")
        for f, want, got in misses:
            print(f"  MISS  {f}: wanted {want}, got {got}")
        for f, got in falses:
            print(f"  FALSE {f}: {got}")
        for f, got in extras:
            print(f"  EXTRA {f}: {got}")
    return {"recall": viol_hit / viol_total, "false_rate": clean_false / clean_total, "wrong": wrong}


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    for s in (["dev", "heldout"] if which == "both" else [which]):   # "stress" is run by name; it shows limits and is never tuned on
        evaluate(s)
