from fastapi.testclient import TestClient

from app.main import app
from app.sample_brand import SAMPLE_BIG, SAMPLE_CONTENT

client = TestClient(app)


def test_merge_endpoint_matches_pipeline_for_sample():
    text = SAMPLE_CONTENT
    calibration = {"r_voice_1": 0.7}
    body = {"revision_id": "sample", "brand_id": "lumina", "text": text,
            "big": SAMPLE_BIG, "calibration": calibration}
    expected = client.post("/review", json=body).json()
    agent_results = [client.post(f"/review/{agent}", json=body).json()
                     for agent in ("tone", "term", "claim")]

    merged = client.post("/merge", json={"text": text, "agents": agent_results,
                                         "calibration": calibration,
                                         "timing": expected["timing"]})

    assert merged.status_code == 200
    actual = merged.json()
    for key in ("text", "score", "summary", "highlights", "calibration"):
        assert actual[key] == expected[key]
    assert [{k: a[k] for k in ("agent", "status", "findings")} for a in actual["agents"]] == [
        {k: a[k] for k in ("agent", "status", "findings")} for a in expected["agents"]]
    assert set(actual["timing"]) == {"first_agent_ms", "total_ms"}


def test_merge_requires_one_result_per_agent():
    r = client.post("/merge", json={"text": "sample", "agents": [], "calibration": {}})
    assert r.status_code == 422
