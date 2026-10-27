"""Logo checks: is an approved (or retired) logo in the image, in the right proportions, in its own colours, with room around it?

The logo is looked for by template matching on gradient (edge) maps rather than on colours, so a recoloured logo is still
found, and then judged separately. The search runs over a range of sizes, and over stretched versions of the logo, so a
squashed or stretched logo is found *and* recognised as distorted instead of being missed."""
from dataclasses import dataclass

import cv2
import numpy as np

from .colour import chroma, delta_e, rgb_to_lab

WORK_SIZE = 800            # longest side of the image used for the final, precise match
COARSE_SIZE = 400          # longest side used for the first, exhaustive search over sizes and proportions
EDGE_BLUR = 2.0            # blur applied to edge maps before matching, in pixels
MIN_TEMPLATE = 24          # smaller templates have too little detail: they match random corners with high scores
MIN_DETAIL = 0.01          # windows whose edge map varies less than this are blank, not logos
MATCH_MIN = 0.66           # normalised correlation of edge maps above which the logo counts as found
SCALES = np.geomspace(0.25, 2.2, 22)    # sizes tried in the coarse search, relative to the approved file
ASPECTS = (0.45, 0.55, 0.65, 0.77, 0.88, 1.0, 1.14, 1.3, 1.5, 1.75, 2.1)   # width / height stretch factors tried in the coarse search
DISTORT_TOLERANCE = 0.10   # a fitted proportion further than 10% from the original counts as distorted
DISTORT_MIN = 0.72         # a stretched fit has more freedom to match by chance, so it must score higher than an undistorted one
DISTORT_GAIN = 0.04        # ... and only if it fits clearly better than the undistorted logo
RECOLOUR_DELTA = 24.0      # delta E between the logo's colour in the image and in the approved file
CLEAR_SPACE = 0.25         # required empty margin, as a share of the logo's shorter side
BUSY_DELTA = 16.0          # a pixel this far from the local background counts as something in the margin
BUSY_SHARE = 0.04          # share of the margin that may be busy before it is reported


@dataclass
class LogoMatch:
    found: bool
    score: float
    bbox: dict            # {x, y, w, h} in the original image's pixels
    aspect: float         # fitted stretch (1.0 = the proportions of the approved file)
    distorted: bool
    recolour_delta: float
    clear_space_busy: float
    clear_space_region: dict
    edge_shortfall: float  # how much of the required margin is missing at the nearest image border (0 = none)


def _edges(rgb: np.ndarray, alpha: np.ndarray | None = None) -> np.ndarray:
    """Gradient magnitude of the lightness channel, normalised to 0..1. Colour changes alone do not matter."""
    lab = rgb_to_lab(rgb)
    L = cv2.GaussianBlur(lab[..., 0].astype(np.float32), (0, 0), 1.0)
    gx, gy = cv2.Sobel(L, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(L, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    if alpha is not None:   # the outline of the logo is an edge too
        a = cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), 1.0)
        ax, ay = cv2.Sobel(a, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(a, cv2.CV_32F, 0, 1, ksize=3)
        mag = np.maximum(mag, 40 * cv2.magnitude(ax, ay))
    mag = cv2.GaussianBlur(mag, (0, 0), EDGE_BLUR)   # soft edges: a slightly wrong size or a JPEG shift still correlates
    peak = float(mag.max())
    return mag / peak if peak > 0 else mag


def split_rgba(logo: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """HxWx4 (or HxWx3, then fully opaque) -> rgb, alpha (0..1), cropped to the visible part."""
    rgb = logo[..., :3]
    alpha = logo[..., 3].astype(np.float32) / 255.0 if logo.shape[-1] == 4 else np.ones(logo.shape[:2], np.float32)
    ys, xs = np.where(alpha > 0.1)
    if len(ys) == 0:
        raise ValueError("the logo is fully transparent")
    return rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1], alpha[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def _window_std(edges: np.ndarray, tw: int, th: int) -> np.ndarray:
    """Standard deviation of the edge map inside every tw x th window (same layout as matchTemplate's output)."""
    ii, sq = cv2.integral2(edges.astype(np.float64))
    def total(a):
        return a[th:, tw:] - a[:-th, tw:] - a[th:, :-tw] + a[:-th, :-tw]
    n = float(tw * th)
    mean = total(ii) / n
    return np.sqrt(np.maximum(total(sq) / n - mean ** 2, 0.0))


def _best_match(img_edges: np.ndarray, tpl_rgb: np.ndarray, tpl_alpha: np.ndarray, sx: float, sy: float):
    h, w = tpl_alpha.shape
    tw, th = round(w * sx), round(h * sy)
    if min(tw, th) < MIN_TEMPLATE:
        return None
    if th >= img_edges.shape[0] or tw >= img_edges.shape[1]:
        return None
    rgb = cv2.resize(tpl_rgb, (tw, th), interpolation=cv2.INTER_AREA)
    alpha = cv2.resize(tpl_alpha, (tw, th), interpolation=cv2.INTER_AREA)
    # Composite on a mid-grey so the logo's outline shows up as an edge, then take its gradient map.
    flat = (rgb * alpha[..., None] + 128 * (1 - alpha[..., None])).astype(np.uint8)
    t_edges = _edges(flat, alpha)
    if t_edges.std() < 1e-4:
        return None
    res = cv2.matchTemplate(img_edges, t_edges, cv2.TM_CCOEFF_NORMED)
    # OpenCV reports a perfect score for windows with no detail at all; those are not matches, so they are removed.
    res[_window_std(img_edges, tw, th) < MIN_DETAIL] = -1.0
    _, score, _, loc = cv2.minMaxLoc(res)
    return float(score), loc, (tw, th), (rgb, alpha)


def _grid(edges, tpl, scales, aspects, factor):
    """Best (score, loc, size, assets, scale, aspect) over a grid of sizes and stretches."""
    best = None
    for a in aspects:
        for sc in scales:
            m = _best_match(edges, tpl[0], tpl[1], sc * factor * np.sqrt(a), sc * factor / np.sqrt(a))
            if m and (best is None or m[0] > best[0]):
                best = (*m, sc, a)
    return best


def _shrink(img: np.ndarray, longest: int):
    f = min(1.0, longest / max(img.shape[:2]))
    return (cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else img), f


def find_logo(img_rgb: np.ndarray, logo_rgba: np.ndarray, *, min_score: float = MATCH_MIN) -> LogoMatch | None:
    """Looks for one logo. Returns None when it is not in the image.

    Two stages: an exhaustive search over sizes and stretches on a small copy of the image, then a precise search around
    the best candidates on a larger copy. The undistorted logo and the best stretched one are carried through separately,
    so the logo is reported as distorted only when a stretched version fits clearly better."""
    tpl = split_rgba(logo_rgba)
    coarse, fc = _shrink(img_rgb, COARSE_SIZE)
    e_coarse = _edges(coarse)
    iso = _grid(e_coarse, tpl, SCALES, (1.0,), fc)
    anyfit = _grid(e_coarse, tpl, SCALES, ASPECTS, fc)
    if anyfit is None or anyfit[0] < min_score * 0.7:
        return None
    fine, ff = _shrink(img_rgb, WORK_SIZE)
    e_fine = _edges(fine)

    def refine(c):
        sc, a = c[4], c[5]
        return _grid(e_fine, tpl, sc * np.array([0.9, 0.95, 1.0, 1.05, 1.1]), (a,) if a == 1.0 else (a * 0.9, a, a * 1.1), ff)

    best_iso = refine(iso) if iso else None
    best_any = refine(anyfit)
    iso_score = best_iso[0] if best_iso else 0.0
    distorted = abs(best_any[5] - 1.0) > DISTORT_TOLERANCE and best_any[0] >= iso_score + DISTORT_GAIN
    distorted = distorted and best_any[0] >= DISTORT_MIN
    chosen = best_any if distorted else best_iso
    if chosen is None or chosen[0] < min_score:
        return None
    score, loc, (tw, th), (rgb, alpha), _, aspect = chosen
    x0, y0 = max(0, int(loc[0] / ff)), max(0, int(loc[1] / ff))
    w0, h0 = min(int(tw / ff), img_rgb.shape[1] - x0), min(int(th / ff), img_rgb.shape[0] - y0)
    bbox = {"x": x0, "y": y0, "w": max(1, w0), "h": max(1, h0)}
    return LogoMatch(True, round(score, 3), bbox, round(float(aspect), 2), bool(distorted),
                     _recolour_delta(img_rgb, bbox, rgb, alpha), *_clear_space(img_rgb, bbox))


def _recolour_delta(img: np.ndarray, bbox: dict, tpl_rgb: np.ndarray, tpl_alpha: np.ndarray) -> float:
    """Largest colour difference between the logo's colours in the approved file and the same parts in the image.

    The approved logo is split into its main colours; for each, the median colour of the matching pixels in the image
    is compared with the file's. Checking each colour separately means a recoloured ring is caught even when the
    big disc inside it is unchanged."""
    x, y, w, h = bbox["x"], bbox["y"], bbox["w"], bbox["h"]
    h2, w2 = tpl_alpha.shape
    crop = cv2.resize(img[y:y + h, x:x + w], (w2, h2), interpolation=cv2.INTER_AREA)
    solid = cv2.erode((tpl_alpha > 0.95).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)   # skip blended edge pixels
    if solid.sum() < 40:
        return 0.0
    want, got = rgb_to_lab(tpl_rgb[solid]), rgb_to_lab(crop[solid])
    cv2.setRNGSeed(1)
    k = min(4, len(np.unique(want.round(0), axis=0)))
    _, labels, _ = cv2.kmeans(want.astype(np.float32), k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 2, cv2.KMEANS_PP_CENTERS)
    labels = labels.ravel()
    worst = 0.0
    for c in range(k):
        sel = labels == c
        if sel.mean() < 0.05:
            continue
        worst = max(worst, float(delta_e(np.median(got[sel], axis=0), np.median(want[sel], axis=0))))
    return round(worst, 1)


def _clear_space(img: np.ndarray, bbox: dict):
    """How much of the required margin around the logo is occupied, and how much of it falls outside the image."""
    H, W = img.shape[:2]
    x, y, w, h = bbox["x"], bbox["y"], bbox["w"], bbox["h"]
    pad = max(2, int(round(CLEAR_SPACE * min(w, h))))
    X0, Y0, X1, Y1 = x - pad, y - pad, x + w + pad, y + h + pad
    shortfall = max(0, -X0, -Y0, X1 - W, Y1 - H) / pad
    cx0, cy0, cx1, cy1 = max(0, X0), max(0, Y0), min(W, X1), min(H, Y1)
    region = {"x": cx0, "y": cy0, "w": cx1 - cx0, "h": cy1 - cy0}
    ring = np.ones((cy1 - cy0, cx1 - cx0), dtype=bool)
    ring[max(0, y - cy0):y + h - cy0, max(0, x - cx0):x + w - cx0] = False     # the logo itself is not part of the margin
    if ring.sum() < 20:
        return 0.0, region, round(float(shortfall), 2)
    lab = rgb_to_lab(img[cy0:cy1, cx0:cx1])
    bg = np.median(lab[ring], axis=0)
    busy = (delta_e(lab, bg) > BUSY_DELTA) & ring
    return round(float(busy.sum() / ring.sum()), 3), region, round(float(shortfall), 2)
