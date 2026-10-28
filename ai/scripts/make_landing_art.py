"""Draws the three picture cards of the landing hero from real VisualGuard output on the held-out test banners:
the original banner with VisualGuard's numbered box on the problem it found. Deterministic.
Run: .venv/bin/python scripts/make_landing_art.py   (writes web/public/landing/*.jpg)"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.visual import agent  # noqa: E402
from scripts.visual_eval import EVAL, assets  # noqa: E402

OUT = ROOT.parent / "web" / "public" / "landing"
COLOUR = {"high": (185, 28, 28), "medium": (180, 83, 9)}


def card(kind: str, name: str):
    labels = json.loads((EVAL / "heldout.json").read_text())
    lab = next(x for x in labels if x["kind"] == kind)
    img, _, _ = agent.decode_image((EVAL / lab["file"]).read_bytes())
    findings = agent.review_image(img, assets())
    pil = Image.fromarray(img)
    d = ImageDraw.Draw(pil)
    for n, f in enumerate(findings, 1):
        r, c = f.region, COLOUR.get(f.severity, (185, 28, 28))
        d.rectangle([r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]], outline=c, width=4)
        d.rectangle([r["x"], r["y"], r["x"] + 26, r["y"] + 26], fill=c)
        d.text((r["x"] + 9, r["y"] + 7), str(n), fill=(255, 255, 255))
    w, h = pil.size
    side = min(w, int(h * 0.8 * 1.0))   # crop to a 4:5 card
    cw, ch = int(h * 0.8), h
    left = max(0, min(w - cw, (lab["region"]["x"] if lab["region"] else w // 2) - cw // 2))
    pil = pil.crop((left, 0, left + cw, ch)).resize((480, 600))
    OUT.mkdir(parents=True, exist_ok=True)
    pil.save(OUT / f"{name}.jpg", "JPEG", quality=84)
    print(name, kind, [f.rule_id for f in findings])


if __name__ == "__main__":
    card("recoloured", "visual-colour")
    card("distorted", "visual-proportions")
    card("palette", "visual-palette")
