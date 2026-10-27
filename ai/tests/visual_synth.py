"""Synthetic brand images for testing and measuring VisualGuard: drawn logos, banners, and controlled violations.
Everything is drawn with Pillow from a seed, so the same call always gives the same pixels."""
import io

import numpy as np
from PIL import Image, ImageDraw

AMBER, BROWN, CREAM, CHARCOAL = "#c77d0a", "#4b2e1e", "#f5ebdd", "#222222"
PALETTE = [{"name": "Amber", "hex": AMBER}, {"name": "Roast brown", "hex": BROWN}, {"name": "Cream", "hex": CREAM}, {"name": "Charcoal", "hex": CHARCOAL}]


def lumina_logo(size: int = 160) -> np.ndarray:
    """The approved mark: an amber disc inside a brown ring with a cream sunrise, as RGBA."""
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([0, 0, s - 1, s - 1], fill=BROWN)
    d.ellipse([s * 0.09, s * 0.09, s * 0.91, s * 0.91], fill=AMBER)
    d.pieslice([s * 0.25, s * 0.42, s * 0.75, s * 0.92], 180, 360, fill=CREAM)
    for k in range(5):
        x = s * (0.28 + 0.11 * k)
        d.line([x, s * 0.36, s * 0.5 + (x - s * 0.5) * 1.5, s * 0.2], fill=CREAM, width=int(s * 0.03))
    return np.array(im.resize((size, size), Image.LANCZOS))


def old_logo(size: int = 160) -> np.ndarray:
    """The retired mark: a square badge with a blocky L, a different shape on purpose."""
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.12), fill=BROWN)
    d.rectangle([s * 0.25, s * 0.2, s * 0.42, s * 0.78], fill=CREAM)
    d.rectangle([s * 0.25, s * 0.62, s * 0.78, s * 0.78], fill=CREAM)
    d.polygon([(s * 0.55, s * 0.2), (s * 0.78, s * 0.2), (s * 0.66, s * 0.45)], fill=AMBER)
    return np.array(im.resize((size, size), Image.LANCZOS))


def decoy(size: int = 120, seed: int = 0) -> np.ndarray:
    """A logo-sized graphic that is NOT a brand logo (a star and a bar), for false-positive tests."""
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pts = [(s * 0.5 + s * 0.45 * (1 if i % 2 == 0 else 0.45) * np.cos(np.pi * i / 5), s * 0.5 + s * 0.45 * (1 if i % 2 == 0 else 0.45) * np.sin(np.pi * i / 5)) for i in range(10)]
    d.polygon(pts, fill=CHARCOAL)
    d.rectangle([s * 0.1, s * 0.8, s * 0.9, s * 0.9], fill=AMBER)
    return np.array(im.resize((size, size), Image.LANCZOS))


def banner(seed: int, w: int = 900, h: int = 520, bg: str = CREAM) -> np.ndarray:
    """A flat on-palette banner: a coloured band, some text-like bars. No logo."""
    rng = np.random.default_rng(seed)
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    band = [BROWN, AMBER, CHARCOAL][int(rng.integers(0, 3))]
    d.rectangle([0, int(h * 0.62), w, h], fill=band)
    for k in range(int(rng.integers(2, 4))):
        y = int(h * (0.18 + 0.12 * k))
        d.rounded_rectangle([int(w * 0.08), y, int(w * (0.45 + 0.2 * rng.random())), y + int(h * 0.05)], radius=4, fill=CHARCOAL if bg == CREAM else CREAM)
    for k in range(3):
        d.rectangle([int(w * 0.08), int(h * 0.7) + k * 24, int(w * (0.3 + 0.15 * rng.random())), int(h * 0.7) + k * 24 + 10], fill=CREAM)
    return np.array(im)


def place(img: np.ndarray, logo: np.ndarray, x: int, y: int, width: int, height: int | None = None) -> np.ndarray:
    """Paste a logo at (x, y) scaled to width x height (height defaults to the logo's own proportions)."""
    height = height or round(width * logo.shape[0] / logo.shape[1])
    im = Image.fromarray(img).convert("RGBA")
    im.alpha_composite(Image.fromarray(logo).resize((width, height), Image.LANCZOS), (x, y))
    return np.array(im.convert("RGB"))


def recolour(logo: np.ndarray, mapping: dict[str, str]) -> np.ndarray:
    """Swap exact brand colours in a drawn logo for others (a logo in the wrong colours)."""
    from app.visual.colour import hex_to_rgb
    out = logo.copy()
    rgb = out[..., :3].astype(int)
    for src, dst in mapping.items():
        near = np.abs(rgb - np.array(hex_to_rgb(src))).sum(axis=-1) < 90
        out[..., :3][near] = hex_to_rgb(dst)
    return out


def jpeg(img: np.ndarray, quality: int = 70) -> np.ndarray:
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, "JPEG", quality=quality)
    return np.array(Image.open(buf).convert("RGB"))


def noise(img: np.ndarray, sigma: float, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return np.clip(img.astype(float) + rng.normal(0, sigma, img.shape), 0, 255).astype(np.uint8)
