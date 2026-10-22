from fastapi.testclient import TestClient
from app.main import app
from app.sample_brand import SAMPLE_BIG

client = TestClient(app)
# "e" + combining accent is two code points; NFC turns it into one, which shifts every later offset by one.
DECOMPOSED = "Caf" + "é" + " fans love java and joe. We are the best coffee in the world."


def _aligned(result):
    text = result["text"]
    return [f for h in result["highlights"] for f in h["findings"] if text[f["span"]["start"]:f["span"]["end"]] != f["quoted_text"]]


def test_single_agent_then_merge_keeps_spans_aligned_for_non_normalised_text():
    body = {"revision_id": "r", "brand_id": "b", "text": DECOMPOSED, "big": SAMPLE_BIG}
    agents = [client.post(f"/review/{a}", json=body).json() for a in ("tone", "term", "claim")]
    merged = client.post("/merge", json={"text": DECOMPOSED, "agents": agents}).json()
    assert sum(len(h["findings"]) for h in merged["highlights"]) >= 3
    assert _aligned(merged) == []


def test_queue_path_matches_in_process_path_for_non_normalised_text():
    body = {"revision_id": "r", "brand_id": "b", "text": DECOMPOSED, "big": SAMPLE_BIG}
    direct = client.post("/review", json=body).json()
    agents = [client.post(f"/review/{a}", json=body).json() for a in ("tone", "term", "claim")]
    merged = client.post("/merge", json={"text": DECOMPOSED, "agents": agents}).json()
    assert merged["highlights"] == direct["highlights"] and merged["score"] == direct["score"]
