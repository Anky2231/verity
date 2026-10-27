"""Colour helpers: hex parsing, sRGB to CIE Lab, and perceptual distance (CIE76 delta E)."""
import numpy as np

# D65 white point
_WHITE = np.array([0.95047, 1.0, 1.08883])
_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]])


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    v = value.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6 or any(c not in "0123456789abcdefABCDEF" for c in v):
        raise ValueError(f"not a hex colour: {value!r}")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def rgb_to_hex(rgb) -> str:
    r, g, b = (int(round(float(x))) for x in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def rgb_to_lab(rgb) -> np.ndarray:
    """rgb: (..., 3) array of 0..255 values -> (..., 3) Lab."""
    c = np.asarray(rgb, dtype=np.float32) / np.float32(255.0)   # float32: half the memory of float64, plenty for colour work
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
    xyz = lin @ _M.T.astype(np.float32) / _WHITE.astype(np.float32)
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116).astype(np.float32)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def delta_e(lab_a, lab_b) -> np.ndarray:
    """CIE76: straight-line distance in Lab. About 2.3 is a just-noticeable difference; 20 or more reads as a different colour."""
    return np.linalg.norm(np.asarray(lab_a) - np.asarray(lab_b), axis=-1)


def chroma(lab) -> np.ndarray:
    lab = np.asarray(lab)
    return np.hypot(lab[..., 1], lab[..., 2])
