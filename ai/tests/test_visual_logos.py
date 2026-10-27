import numpy as np
import pytest
from tests import visual_synth as S
from app.visual import logos

LOGO, OLD = S.lumina_logo(), S.old_logo()
BASE = S.banner(1)


def near(box, x, y, w, h, tol=6):
    return all(abs(box[k] - v) <= tol for k, v in zip("xywh", (x, y, w, h)))


def test_no_logo_in_a_plain_banner_means_no_match():
    assert logos.find_logo(BASE, LOGO) is None


@pytest.mark.parametrize("width", [60, 120, 220])
def test_the_approved_logo_is_found_at_different_sizes_with_its_rectangle(width):
    m = logos.find_logo(S.place(BASE, LOGO, 600, 40, width), LOGO)
    assert m and m.found and m.score >= 0.7
    assert near(m.bbox, 600, 40, width, width)
    assert not m.distorted and m.aspect == 1.0 and m.recolour_delta < logos.RECOLOUR_DELTA


def test_a_stretched_logo_is_found_and_called_distorted():
    m = logos.find_logo(S.place(BASE, LOGO, 600, 40, 220, 110), LOGO)
    assert m and m.distorted and m.aspect > 1.5 and near(m.bbox, 600, 40, 220, 110, tol=10)


def test_a_squashed_logo_is_found_and_called_distorted():
    m = logos.find_logo(S.place(BASE, LOGO, 600, 40, 100, 200), LOGO)
    assert m and m.distorted and m.aspect < 0.7


def test_a_recoloured_logo_is_found_and_its_colour_difference_is_large():
    disc = logos.find_logo(S.place(BASE, S.recolour(LOGO, {S.AMBER: "#2060d0"}), 700, 60, 120), LOGO)
    ring = logos.find_logo(S.place(BASE, S.recolour(LOGO, {S.BROWN: "#cc2222"}), 700, 60, 120), LOGO)
    assert disc and disc.recolour_delta > logos.RECOLOUR_DELTA * 2
    assert ring and ring.recolour_delta > logos.RECOLOUR_DELTA, "a recoloured outer ring is caught even though the inner disc is unchanged"


def test_the_retired_logo_is_found_by_its_own_template_and_not_by_the_approved_one():
    img = S.place(BASE, OLD, 700, 60, 120)
    assert logos.find_logo(img, OLD) is not None
    assert logos.find_logo(img, LOGO) is None
    assert logos.find_logo(S.place(BASE, LOGO, 700, 60, 120), OLD) is None


def test_other_graphics_are_not_mistaken_for_the_logo():
    assert logos.find_logo(S.place(BASE, S.decoy(), 700, 60, 120), LOGO) is None


def test_clutter_next_to_the_logo_is_measured_as_busy_margin():
    clear = logos.find_logo(S.place(BASE, LOGO, 700, 60, 120), LOGO)
    crowded = logos.find_logo(S.place(BASE, LOGO, 60, 60, 120), LOGO)     # right next to the text bars
    assert clear.clear_space_busy < logos.BUSY_SHARE
    assert crowded.clear_space_busy > logos.BUSY_SHARE


def test_a_logo_pushed_against_the_edge_reports_the_missing_margin():
    m = logos.find_logo(S.place(BASE, LOGO, 770, 4, 120), LOGO)
    assert m.edge_shortfall > 0.5
    assert logos.find_logo(S.place(BASE, LOGO, 700, 160, 120), LOGO).edge_shortfall == 0


def test_the_logo_survives_jpeg_compression_and_noise():
    img = S.noise(S.jpeg(S.place(BASE, LOGO, 700, 60, 120), 60), 4)
    m = logos.find_logo(img, LOGO)
    assert m and near(m.bbox, 700, 60, 120, 120, tol=8) and m.recolour_delta < logos.RECOLOUR_DELTA


def test_a_fully_transparent_logo_is_an_error():
    with pytest.raises(ValueError):
        logos.find_logo(BASE, np.zeros((40, 40, 4), dtype=np.uint8))


def test_the_same_image_gives_the_same_answer():
    img = S.place(BASE, LOGO, 600, 40, 150)
    assert logos.find_logo(img, LOGO) == logos.find_logo(img, LOGO)
