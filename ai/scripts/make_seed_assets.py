"""Draws the demo brand logos the API seeds into each brand's asset library (api/seed/assets/*.png).
Run: .venv/bin/python scripts/make_seed_assets.py   (deterministic)"""
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests import visual_synth as S  # noqa: E402

OUT = ROOT.parent / "api" / "seed" / "assets"


def northwind_logo(size: int = 160) -> np.ndarray:
    """A slate ring, a tea-green disc and a pale leaf."""
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([0, 0, s - 1, s - 1], fill="#2a3a35")
    d.ellipse([s * 0.09, s * 0.09, s * 0.91, s * 0.91], fill="#3f6b4a")
    d.polygon([(s * 0.3, s * 0.7), (s * 0.45, s * 0.3), (s * 0.72, s * 0.28), (s * 0.7, s * 0.55), (s * 0.5, s * 0.74)], fill="#f4f7f2")
    d.line([(s * 0.34, s * 0.68), (s * 0.62, s * 0.4)], fill="#3f6b4a", width=int(s * 0.025))
    return np.array(im.resize((size, size), Image.LANCZOS))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(S.lumina_logo()).save(OUT / "lumina_logo.png", optimize=True)
    Image.fromarray(S.old_logo()).save(OUT / "lumina_logo_2019.png", optimize=True)
    Image.fromarray(northwind_logo()).save(OUT / "northwind_logo.png", optimize=True)
    print("wrote", sorted(p.name for p in OUT.glob("*.png")))
