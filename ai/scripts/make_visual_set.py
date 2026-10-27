"""Builds the VisualGuard test sets in ai/eval/visual/: 'dev' (used while tuning thresholds) and 'heldout' (never used to tune).

Each image is a synthetic brand banner drawn with Pillow (see tests/visual_synth.py) with at most one planted violation, then
degraded the way real files are: random size, JPEG compression and noise. The images and labels.json are committed, so the
numbers can be reproduced without redrawing anything.   Run: .venv/bin/python scripts/make_visual_set.py"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.visual.colour import hex_to_rgb  # noqa: E402
from tests import visual_synth as S  # noqa: E402

OUT = ROOT / "eval" / "visual"
LOGO, OLD = S.lumina_logo(), S.old_logo()
OFF_COLOURS = ["#2060d0", "#10a040", "#d020a0", "#20b0b0", "#d03030", "#8030d0"]
RECOLOURS = ["#2060d0", "#10a040", "#cc2222", "#d020a0", "#202020"]


def bar(img, x, y, w, h, colour=S.CHARCOAL):
    im = Image.fromarray(img)
    ImageDraw.Draw(im).rectangle([x, y, x + w, y + h], fill=colour)
    return np.array(im)


def make(kind: str, seed: int):
    """-> (image, expected rules, region of the violation or None)"""
    rng = np.random.default_rng(seed)
    w, h = int(rng.integers(560, 800)), int(rng.integers(340, 480))
    base = S.banner(int(rng.integers(0, 10_000)), w, h)
    # The banner's text bars sit on the left and its colour band at the bottom, so a logo with a proper margin goes in the
    # open space at the top right. The logo is sized to fit there with a quarter of its size free on every side.
    lw = min(int(rng.integers(64, 150)), int(0.62 * h / 1.8))   # small enough to fit above the colour band with its margin
    lx = int(rng.integers(int(w * 0.68), max(int(w * 0.68) + 1, w - int(lw * 1.35))))
    ly = int(rng.integers(int(lw * 0.4), max(int(lw * 0.4) + 1, int(h * 0.6) - int(lw * 1.35))))
    expected, region = [], None
    logo, img = LOGO, base
    if kind == "palette":
        bw, bh = int(w * rng.uniform(0.25, 0.45)), int(h * rng.uniform(0.25, 0.45))
        bx, by = int(rng.integers(0, w - bw)), int(rng.integers(int(h * 0.4), max(int(h * 0.4) + 1, h - bh)))
        img = base.copy()
        img[by:by + bh, bx:bx + bw] = hex_to_rgb(OFF_COLOURS[int(rng.integers(0, len(OFF_COLOURS)))])
        expected, region = ["v_palette"], {"x": bx, "y": by, "w": bw, "h": bh}
    elif kind == "recoloured":
        swap = {S.AMBER: RECOLOURS[int(rng.integers(0, len(RECOLOURS)))]} if rng.random() < 0.6 else {S.BROWN: RECOLOURS[int(rng.integers(0, len(RECOLOURS)))]}
        logo, expected = S.recolour(LOGO, swap), ["v_logo_colour"]
    elif kind == "retired":
        logo, expected = OLD, ["v_logo_retired"]
    if kind == "distorted":
        f = float(rng.choice([rng.uniform(1.4, 2.0), rng.uniform(0.5, 0.72)]))
        lw2, lh2 = int(lw * f ** 0.5), int(lw / f ** 0.5)
        img = S.place(base, logo, lx, ly, lw2, lh2)
        expected, region = ["v_logo_distorted"], {"x": lx, "y": ly, "w": lw2, "h": lh2}
    elif kind == "crowded":
        img = S.place(base, logo, lx, ly, lw)
        gap = int(lw * rng.uniform(0.02, 0.1))
        side = rng.choice(["right", "below"])
        img = bar(img, lx + lw + gap, ly + lw // 4, int(lw * 0.9), max(10, lw // 5)) if side == "right" else bar(img, lx, ly + lw + gap, lw, max(10, lw // 5))
        expected, region = ["v_logo_space"], {"x": lx, "y": ly, "w": lw, "h": lw}
    elif kind == "edge":
        lx, ly = int(rng.choice([2, 4, int(lw * 0.05)])), int(rng.integers(2, int(lw * 0.08) + 3))
        img = S.place(base, logo, lx, ly, lw)
        expected, region = ["v_logo_space"], {"x": lx, "y": ly, "w": lw, "h": lw}
    elif kind == "compliant":
        img = S.place(base, logo, lx, ly, lw) if rng.random() > 0.15 else base       # a few compliant images have no logo at all
    elif kind != "distorted":
        img = S.place(img, logo, lx, ly, lw)
        if kind in ("recoloured", "retired"):
            region = {"x": lx, "y": ly, "w": lw, "h": lw}
    if rng.random() < 0.6:
        img = S.jpeg(img, int(rng.integers(55, 92)))
    if rng.random() < 0.5:
        img = S.noise(img, float(rng.uniform(1, 4)), int(rng.integers(0, 1000)))
    return img, expected, region


PLAN = {"palette": 5, "distorted": 4, "recoloured": 4, "retired": 4, "crowded": 3, "edge": 2, "compliant": 8}   # 30 images


def build(name: str, seed0: int):
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)
    labels, n = [], 0
    for kind, count in PLAN.items():
        for i in range(count):
            img, expected, region = make(kind, seed0 + n)
            fn = f"{name}_{n:02d}_{kind}.jpg"
            Image.fromarray(img).save(folder / fn, "JPEG", quality=88)   # stored as the JPEG a designer would export
            labels.append({"file": f"{name}/{fn}", "kind": kind, "expected": expected, "region": region})
            n += 1
    (OUT / f"{name}.json").write_text(json.dumps(labels, indent=1))
    print(f"{name}: {n} images")


STRESS_KINDS = ("compliant", "recoloured", "retired", "distorted")
STRESS_DEGRADE = ("heavy_jpeg", "blur", "rotated_logo", "photo_background", "cropped_logo")


def make_stress(kind: str, degrade: str, seed: int):
    """Harder cases than the dev and held-out sets, to show where VisualGuard stops working. Not used for any tuning."""
    from PIL import ImageFilter
    rng = np.random.default_rng(seed)
    w, h = 720, 420
    lw = 130
    base = S.banner(int(rng.integers(0, 10_000)), w, h)
    lx, ly = int(w * 0.72), 50
    logo = {"recoloured": S.recolour(LOGO, {S.AMBER: "#2060d0"}), "retired": OLD}.get(kind, LOGO)
    if degrade == "photo_background":
        yy, xx = np.mgrid[0:h, 0:w]
        t = (0.6 * xx / w + 0.4 * yy / h)
        photo = np.stack([200 - 70 * t, 150 - 40 * t + 25 * np.sin(xx / 40), 110 + 60 * t], axis=-1) + rng.normal(0, 9, (h, w, 3))
        base = np.clip(photo, 0, 255).astype(np.uint8)
    if degrade == "rotated_logo":
        rot = np.array(Image.fromarray(logo).rotate(8, expand=True, resample=Image.BICUBIC))
        logo = rot
    if degrade == "cropped_logo":
        lx = w - int(lw * 0.7)
    lh = lw if kind != "distorted" else int(lw * 0.6)
    img = S.place(base, logo, lx, ly, lw if degrade != "rotated_logo" else int(lw * 1.1), lh if degrade != "rotated_logo" else None) if degrade != "cropped_logo" else None
    if degrade == "cropped_logo":
        canvas = np.array(Image.new("RGB", (w + int(lw * 0.3), h), S.CREAM)); canvas[:, :w] = base
        img = S.place(canvas, logo, lx, ly, lw, lh)[:, :w]
    if degrade == "heavy_jpeg":
        img = S.noise(S.jpeg(img, 25), 7, seed)
    if degrade == "blur":
        img = np.array(Image.fromarray(img).filter(ImageFilter.GaussianBlur(2.2)))
    expected = {"compliant": [], "recoloured": ["v_logo_colour"], "retired": ["v_logo_retired"], "distorted": ["v_logo_distorted"]}[kind]
    return img, expected, (None if kind == "compliant" else {"x": lx, "y": ly, "w": min(lw, w - lx), "h": lh})


def build_stress(seed0: int = 9000):
    folder = OUT / "stress"
    folder.mkdir(parents=True, exist_ok=True)
    labels, n = [], 0
    for degrade in STRESS_DEGRADE:
        for kind in STRESS_KINDS:
            img, expected, region = make_stress(kind, degrade, seed0 + n)
            fn = f"stress_{n:02d}_{degrade}_{kind}.jpg"
            Image.fromarray(img).save(folder / fn, "JPEG", quality=88)
            labels.append({"file": f"stress/{fn}", "kind": kind, "degrade": degrade, "expected": expected, "region": region})
            n += 1
    (OUT / "stress.json").write_text(json.dumps(labels, indent=1))
    print(f"stress: {n} images")


if __name__ == "__main__":
    (OUT / "assets").mkdir(parents=True, exist_ok=True)
    Image.fromarray(LOGO).save(OUT / "assets" / "lumina_logo.png")
    Image.fromarray(OLD).save(OUT / "assets" / "lumina_logo_2019.png")
    (OUT / "assets" / "palette.json").write_text(json.dumps(S.PALETTE, indent=1))
    build("dev", 1000)
    build("heldout", 5000)
    build_stress()
