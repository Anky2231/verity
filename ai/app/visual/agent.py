"""VisualGuard agent: turns the palette and logo checks into findings in the same format the text agents use.

A finding's `region` is a rectangle {x, y, w, h} in the pixels of the image that was analysed. Everything downstream
(MetaAgent, score, audit, the findings panel) treats it like any other finding; only the highlight is a box instead of a
text span."""
import base64
import io

import numpy as np
from PIL import Image, ImageOps

from ..models import Finding
from . import logos, palette
from .colour import hex_to_rgb

MAX_PIXELS = 25_000_000      # refuse images larger than this
WORK_LONG_SIDE = 1600        # larger images are shrunk to this before analysis; regions are reported in the shrunk image
RETIRED_OVERLAP = 0.5        # a retired-logo match this much inside an approved-logo match is the same object, not a second logo

CLAUSES = {
    "v_palette": "Visual §1.1 Colour palette",
    "v_logo_distorted": "Visual §2.1 Logo proportions",
    "v_logo_colour": "Visual §2.2 Logo colours",
    "v_logo_space": "Visual §2.3 Logo clear space",
    "v_logo_retired": "Visual §2.4 Retired logo",
}


class ImageError(ValueError):
    """The upload is not an image we can read."""


def decode_image(data: bytes) -> tuple[np.ndarray, int, int]:
    """Bytes of a PNG, JPEG, WebP or GIF -> RGB array (transparency flattened onto white), width, height of what is analysed."""
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception as e:  # noqa: BLE001 - any decoder error means "not a usable image"
        raise ImageError("that file is not an image we can read (use PNG, JPEG, WebP or GIF)") from e
    if im.width * im.height > MAX_PIXELS:
        raise ImageError("that image is too large to analyse")
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        white = Image.new("RGBA", im.size, (255, 255, 255, 255))
        white.alpha_composite(im)
        im = white
    im = im.convert("RGB")
    if max(im.size) > WORK_LONG_SIDE:
        f = WORK_LONG_SIDE / max(im.size)
        im = im.resize((round(im.width * f), round(im.height * f)), Image.LANCZOS)
    return np.array(im), im.width, im.height


def decode_logo(data: bytes) -> np.ndarray:
    try:
        return np.array(Image.open(io.BytesIO(data)).convert("RGBA"))
    except Exception as e:  # noqa: BLE001
        raise ImageError("a logo file could not be read") from e


def _iou_inside(a: dict, b: dict) -> float:
    """Share of box a that lies inside box b."""
    x0, y0 = max(a["x"], b["x"]), max(a["y"], b["y"])
    x1, y1 = min(a["x"] + a["w"], b["x"] + b["w"]), min(a["y"] + a["h"], b["y"] + b["h"])
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    return inter / max(1, a["w"] * a["h"])


def _finding(rule: str, region: dict, quoted: str, conf: float, severity: str, why: str, suggestion: str) -> Finding:
    return Finding(agent="visual", rule_id=rule, clause_citation=CLAUSES[rule], region=region, quoted_text=quoted,
                   confidence=round(max(0.0, min(0.97, conf)), 2), severity=severity, explanation=why, suggestion=suggestion)


def review_image(img: np.ndarray, assets: dict) -> list[Finding]:
    """assets: {palette: [{name, hex}], logos: [{id, name, rgba}], retired_logos: [{id, name, rgba}]} -> findings."""
    findings: list[Finding] = []
    for issue in palette.check_palette(img, assets.get("palette", [])):
        conf = 0.55 + 0.4 * min(1.0, (issue.delta - palette.MAX_DELTA) / 40.0)
        findings.append(_finding(
            "v_palette", issue.region, f"Off-palette colour {issue.hex}", conf, "high" if issue.share >= 0.15 else "medium",
            f"About {round(issue.share * 100)}% of the image is {issue.hex}, which is not in the brand palette. The closest approved colour is {issue.nearest_name} ({issue.nearest_hex}).",
            f"Use {issue.nearest_name} ({issue.nearest_hex}) or another colour from the brand palette."))

    approved_boxes = []
    for logo in assets.get("logos", []):
        m = logos.find_logo(img, logo["rgba"])
        if not m:
            continue
        approved_boxes.append(m.bbox)
        name = logo.get("name", "logo")
        if m.distorted:
            findings.append(_finding(
                "v_logo_distorted", m.bbox, f"{name} (stretched)", 0.6 + 0.4 * m.score, "high",
                f"The {name} has been stretched: it is {m.aspect:.2f} times as wide for its height as the approved file. Logos must keep their proportions.",
                "Scale the logo evenly, without stretching or squashing it."))
        if m.recolour_delta > logos.RECOLOUR_DELTA:
            findings.append(_finding(
                "v_logo_colour", m.bbox, f"{name} (wrong colours)", 0.55 + 0.4 * min(1.0, (m.recolour_delta - logos.RECOLOUR_DELTA) / 40.0), "high",
                f"The {name} is not in its approved colours (colour difference {m.recolour_delta:.0f}; about {logos.RECOLOUR_DELTA:.0f} is the most we accept).",
                "Use the approved colour version of the logo, or the approved one-colour version."))
        if m.clear_space_busy > logos.BUSY_SHARE or m.edge_shortfall > 0.5:
            reason = ("It sits too close to the edge of the image" if m.edge_shortfall > 0.5
                      else f"Other content takes up {round(m.clear_space_busy * 100)}% of the margin around it")
            findings.append(_finding(
                "v_logo_space", m.clear_space_region, f"{name} (clear space)", 0.6 + 0.3 * min(1.0, max(m.clear_space_busy / 0.2, m.edge_shortfall)), "medium",
                f"The {name} needs an empty margin of {round(logos.CLEAR_SPACE * 100)}% of its size on every side. {reason}.",
                "Move other elements away from the logo, or move the logo away from the edge."))

    for logo in assets.get("retired_logos", []):
        m = logos.find_logo(img, logo["rgba"])
        if m and not any(_iou_inside(m.bbox, b) >= RETIRED_OVERLAP for b in approved_boxes):
            findings.append(_finding(
                "v_logo_retired", m.bbox, f"{logo.get('name', 'retired logo')} (retired)", 0.55 + 0.4 * m.score, "high",
                f"This is the retired {logo.get('name', 'logo')}. It was replaced by the current approved logo and must not be used.",
                "Replace it with the current approved logo."))
    return findings


def parse_palette(raw: list[dict]) -> list[dict]:
    """Keeps entries with a valid hex colour; a bad one is dropped rather than failing the whole review."""
    out = []
    for p in raw or []:
        try:
            hex_to_rgb(p["hex"])
            out.append({"name": str(p.get("name") or p["hex"])[:60], "hex": p["hex"]})
        except (KeyError, ValueError, TypeError):
            continue
    return out


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")
