"""Palette check: which large colours in an image are not in the brand palette?

The image is shrunk, its colours are grouped with k-means in Lab space, and every group that covers a visible share of
the image is compared with its nearest palette colour. A group further away than MAX_DELTA that is not a neutral (white,
grey, black) is reported with the rectangle where it mostly sits. Small groups are ignored on purpose: anti-aliasing,
photo noise and JPEG artefacts produce many tiny off-palette colours that nobody would call a brand violation."""
from dataclasses import dataclass

import cv2
import numpy as np

from .colour import chroma, delta_e, hex_to_rgb, rgb_to_hex, rgb_to_lab

MAX_DELTA = 22.0        # delta E from the nearest palette colour above which a colour counts as off-palette
MIN_SHARE = 0.03        # a colour must cover at least 3% of the image to matter
NEUTRAL_CHROMA = 10.0   # below this a colour is grey (white, black, grey) and allowed unless the caller says otherwise
WORK_SIZE = 240         # longest side the image is shrunk to before clustering
CLUSTERS = 8


@dataclass
class PaletteIssue:
    hex: str
    share: float
    nearest_name: str
    nearest_hex: str
    delta: float
    region: dict          # {x, y, w, h} in the original image's pixels


def _resize(img: np.ndarray) -> tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    scale = min(1.0, WORK_SIZE / max(h, w))
    if scale == 1.0:
        return img, 1.0
    return cv2.resize(img, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA), scale


def check_palette(img_rgb: np.ndarray, palette: list[dict], *, max_delta: float = MAX_DELTA, min_share: float = MIN_SHARE,
                  neutrals_ok: bool = True) -> list[PaletteIssue]:
    """img_rgb: HxWx3 uint8. palette: [{name, hex}]. Returns off-palette colours, largest first."""
    if not palette:
        return []
    small, scale = _resize(img_rgb)
    lab = rgb_to_lab(small).reshape(-1, 3).astype(np.float32)
    k = min(CLUSTERS, len(np.unique(lab, axis=0)))
    if k < 1:
        return []
    cv2.setRNGSeed(1)   # k-means starts from random centres; a fixed seed makes every run give the same answer
    _, labels, centres = cv2.kmeans(lab, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5), 3, cv2.KMEANS_PP_CENTERS)
    labels = labels.reshape(small.shape[:2])
    pal_lab = rgb_to_lab(np.array([hex_to_rgb(p["hex"]) for p in palette]))
    issues: list[PaletteIssue] = []
    for i, centre in enumerate(centres):
        mask = labels == i
        share = float(mask.mean())
        if share < min_share:
            continue
        if neutrals_ok and chroma(centre) < NEUTRAL_CHROMA:
            continue
        d = delta_e(pal_lab, centre)
        j = int(np.argmin(d))
        if d[j] <= max_delta:
            continue
        # The rectangle around the largest connected patch of this colour, mapped back to the original image.
        count, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
        x, y, w, h, _ = stats[1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))] if count > 1 else (0, 0, small.shape[1], small.shape[0], 0)
        region = {"x": int(x / scale), "y": int(y / scale), "w": max(1, int(w / scale)), "h": max(1, int(h / scale))}
        # Back to RGB for display: average the actual pixels of the cluster rather than inverting Lab.
        rgb = small[mask].mean(axis=0)
        issues.append(PaletteIssue(rgb_to_hex(rgb), round(share, 3), palette[j].get("name", palette[j]["hex"]), palette[j]["hex"], round(float(d[j]), 1), region))
    return sorted(issues, key=lambda x: -x.share)
