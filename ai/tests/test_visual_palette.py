import numpy as np
import pytest
from app.visual import palette as pal
from app.visual.colour import hex_to_rgb

PALETTE = [{"name": "Roast brown", "hex": "#4b2e1e"}, {"name": "Amber", "hex": "#c77d0a"}, {"name": "Cream", "hex": "#f5ebdd"}]


def canvas(w=300, h=200, colour="#f5ebdd"):
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = hex_to_rgb(colour)
    return img


def block(img, x, y, w, h, colour):
    img[y:y + h, x:x + w] = hex_to_rgb(colour)
    return img


def test_a_compliant_image_has_no_issues():
    img = block(block(canvas(), 20, 20, 120, 80, "#4b2e1e"), 160, 100, 100, 60, "#c77d0a")
    assert pal.check_palette(img, PALETTE) == []


def test_an_off_palette_block_is_reported_with_its_rectangle():
    img = block(canvas(), 150, 40, 100, 100, "#2060d0")      # a blue that no palette colour is near
    issues = pal.check_palette(img, PALETTE)
    assert len(issues) == 1
    i = issues[0]
    assert i.hex == "#2060d0" and i.delta > 40 and 0.15 < i.share < 0.2
    assert abs(i.region["x"] - 150) <= 3 and abs(i.region["y"] - 40) <= 3 and abs(i.region["w"] - 100) <= 4 and abs(i.region["h"] - 100) <= 4


def test_a_slightly_different_brand_colour_is_tolerated():
    img = block(canvas(), 20, 20, 150, 120, "#cc800d")      # a hair from the amber
    assert pal.check_palette(img, PALETTE) == []


def test_neutrals_are_allowed_unless_the_caller_says_otherwise():
    img = block(block(canvas(), 0, 0, 150, 200, "#ffffff"), 150, 0, 150, 100, "#808080")
    assert pal.check_palette(img, PALETTE) == []
    assert pal.check_palette(img, PALETTE, neutrals_ok=False) != []


def test_a_tiny_speck_of_another_colour_is_ignored():
    img = block(canvas(), 10, 10, 12, 12, "#ff00ff")         # about 0.7% of the image
    assert pal.check_palette(img, PALETTE) == []


def test_jpeg_noise_on_a_compliant_image_does_not_raise_an_issue():
    rng = np.random.default_rng(3)
    img = block(block(canvas(), 20, 20, 120, 80, "#4b2e1e"), 160, 100, 100, 60, "#c77d0a")
    noisy = np.clip(img.astype(int) + rng.integers(-6, 7, img.shape), 0, 255).astype(np.uint8)
    assert pal.check_palette(noisy, PALETTE) == []


def test_no_palette_means_no_check():
    assert pal.check_palette(canvas(colour="#2060d0"), []) == []


def test_the_result_is_the_same_every_time():
    img = block(block(canvas(), 150, 40, 100, 100, "#2060d0"), 10, 120, 80, 60, "#10a040")
    a, b = pal.check_palette(img, PALETTE), pal.check_palette(img, PALETTE)
    assert a == b and len(a) == 2


def test_large_images_are_mapped_back_to_original_pixels():
    img = block(canvas(1200, 800), 600, 160, 400, 400, "#2060d0")
    i = pal.check_palette(img, PALETTE)[0]
    assert abs(i.region["x"] - 600) <= 12 and abs(i.region["w"] - 400) <= 16
