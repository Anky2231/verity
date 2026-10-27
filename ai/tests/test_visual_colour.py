import numpy as np
import pytest
from app.visual import colour


def test_hex_round_trip_and_short_form():
    assert colour.hex_to_rgb("#C77D0A") == (199, 125, 10)
    assert colour.hex_to_rgb("fff") == (255, 255, 255)
    assert colour.rgb_to_hex((199, 125, 10)) == "#c77d0a"


@pytest.mark.parametrize("bad", ["", "#12", "#GGGGGG", "12345678"])
def test_bad_hex_is_rejected(bad):
    with pytest.raises(ValueError):
        colour.hex_to_rgb(bad)


def test_lab_of_known_colours():
    white, black = colour.rgb_to_lab([255, 255, 255]), colour.rgb_to_lab([0, 0, 0])
    assert white[0] == pytest.approx(100, abs=0.1) and abs(white[1]) < 0.1 and abs(white[2]) < 0.1
    assert black[0] == pytest.approx(0, abs=0.1)
    red = colour.rgb_to_lab([255, 0, 0])
    assert red[0] == pytest.approx(53.2, abs=0.5) and red[1] == pytest.approx(80.1, abs=1)


def test_delta_e_orders_colours_the_way_people_see_them():
    amber = colour.rgb_to_lab([199, 125, 10])
    slightly = colour.rgb_to_lab([203, 128, 14])
    blue = colour.rgb_to_lab([20, 60, 200])
    assert colour.delta_e(amber, slightly) < 5
    assert colour.delta_e(amber, blue) > 60
    assert colour.delta_e(amber, amber) == 0


def test_chroma_is_zero_for_greys():
    assert colour.chroma(colour.rgb_to_lab([128, 128, 128])) < 0.5
    assert colour.chroma(colour.rgb_to_lab([200, 40, 40])) > 40


def test_works_on_whole_images():
    img = np.zeros((4, 5, 3), dtype=np.uint8)
    assert colour.rgb_to_lab(img).shape == (4, 5, 3)
