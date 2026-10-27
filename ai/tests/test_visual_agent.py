import base64
import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.visual import agent
from tests import visual_synth as S

LOGO, OLD = S.lumina_logo(), S.old_logo()
ASSETS = {"palette": S.PALETTE, "logos": [{"id": "logo", "name": "Lumina logo", "rgba": LOGO}],
          "retired_logos": [{"id": "old", "name": "2019 Lumina logo", "rgba": OLD}]}
BASE = S.banner(2)
rules = lambda img: sorted(f.rule_id for f in agent.review_image(img, ASSETS))  # noqa: E731


def test_a_compliant_banner_with_the_approved_logo_has_no_findings():
    assert rules(S.place(BASE, LOGO, 700, 60, 120)) == []


def test_each_violation_gives_its_own_rule_and_a_region_inside_the_image():
    blue = BASE.copy(); blue[300:460, 80:300] = (32, 96, 208)
    cases = {"v_palette": S.place(blue, LOGO, 700, 60, 120)}
    cases["v_logo_distorted"] = S.place(BASE, LOGO, 600, 40, 220, 110)
    cases["v_logo_colour"] = S.place(BASE, S.recolour(LOGO, {S.AMBER: "#2060d0"}), 700, 60, 120)
    cases["v_logo_space"] = S.place(BASE, LOGO, 60, 60, 120)
    cases["v_logo_retired"] = S.place(BASE, OLD, 700, 60, 120)
    for rule, img in cases.items():
        found = agent.review_image(img, ASSETS)
        assert rule in {f.rule_id for f in found}, f"{rule}: got {[f.rule_id for f in found]}"
        f = next(x for x in found if x.rule_id == rule)
        r = f.region
        assert f.agent == "visual" and f.span is None and f.clause_citation == agent.CLAUSES[rule]
        assert 0 <= r["x"] and 0 <= r["y"] and r["w"] > 0 and r["h"] > 0
        assert r["x"] + r["w"] <= img.shape[1] and r["y"] + r["h"] <= img.shape[0]
        assert 0.5 <= f.confidence <= 0.97 and f.explanation and f.suggestion


def test_the_retired_logo_is_not_also_reported_inside_the_approved_logo():
    assert "v_logo_retired" not in rules(S.place(BASE, LOGO, 700, 60, 120))


def test_a_clean_image_without_any_logo_is_not_penalised():
    assert rules(BASE) == []


def test_regions_are_in_the_pixels_of_the_analysed_image_after_decoding():
    big = np.array(Image.fromarray(S.place(BASE, LOGO, 700, 60, 120)).resize((3600, 2080)))
    buf = io.BytesIO(); Image.fromarray(big).save(buf, "PNG")
    img, w, h = agent.decode_image(buf.getvalue())
    assert max(w, h) == agent.WORK_LONG_SIDE and img.shape[:2] == (h, w)


def test_decode_rejects_things_that_are_not_images():
    with pytest.raises(agent.ImageError):
        agent.decode_image(b"%PDF-1.4 not an image")


def test_transparent_png_is_flattened_onto_white():
    im = Image.new("RGBA", (50, 50), (0, 0, 0, 0)); buf = io.BytesIO(); im.save(buf, "PNG")
    img, _, _ = agent.decode_image(buf.getvalue())
    assert (img == 255).all()


def test_parse_palette_drops_bad_colours_instead_of_failing():
    assert agent.parse_palette([{"name": "ok", "hex": "#fff"}, {"hex": "nope"}, {"name": "x"}, "junk"]) == [{"name": "ok", "hex": "#fff"}]


# ---- the HTTP endpoint ----
client = TestClient(app)


def png(arr) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG")
    return buf.getvalue()


def post(img, **extra):
    enc = lambda a: agent.b64(png(a))  # noqa: E731
    body = {"image_base64": enc(img), "filename": "banner.png", "palette": S.PALETTE,
            "logos": [{"id": "logo", "name": "Lumina logo", "data_base64": enc(LOGO)}], "retired_logos": [{"id": "old", "name": "2019 logo", "data_base64": enc(OLD)}], **extra}
    return client.post("/visual/review", json=body)


def test_endpoint_returns_a_scored_review_in_the_usual_shape():
    r = post(S.place(BASE, S.recolour(LOGO, {S.AMBER: "#2060d0"}), 700, 60, 120))
    assert r.status_code == 200
    out = r.json()
    assert out["score"] < 100 and out["highlights"] and out["highlights"][0]["span"] is None
    assert out["highlights"][0]["findings"][0]["region"]["w"] > 0
    assert out["agents"][0]["agent"] == "visual" and out["agents"][0]["status"] == "ok"
    assert out["image"]["width"] == 900 and out["image"]["height"] == 520
    clean = post(S.place(BASE, LOGO, 700, 60, 120)).json()
    assert clean["score"] == 100 and clean["highlights"] == []


def test_endpoint_rejects_a_file_that_is_not_an_image():
    r = client.post("/visual/review", json={"image_base64": agent.b64(b"hello"), "palette": []})
    assert r.status_code == 422 and "not an image" in r.json()["detail"]


def test_endpoint_rejects_broken_base64():
    assert client.post("/visual/review", json={"image_base64": "***", "palette": []}).status_code == 422


def test_the_endpoint_needs_the_service_token_when_one_is_set(monkeypatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", "secret")
    assert post(BASE).status_code == 401
