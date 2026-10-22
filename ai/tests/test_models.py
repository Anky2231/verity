from fastapi.testclient import TestClient
from app.main import app
from app.models import Finding, Span

client = TestClient(app)


def test_health():
    assert client.get("/health").json()["ok"] is True


def test_single_agent_endpoint_runs_one_agent():
    r = client.post("/review/tone", json={"revision_id": "r1", "brand_id": "b1", "text": "hello"})
    assert r.status_code == 200 and r.json()["agent"] == "tone"
    assert r.json()["status"] == "ok"
    assert all(f["agent"] == "tone" for f in r.json()["findings"])


def test_single_agent_rejects_unknown_agent():
    r = client.post("/review/unknown", json={"revision_id": "r1", "brand_id": "b1", "text": "hello"})
    assert r.status_code == 404


def test_span_verification():
    text = "We are the best coffee in the world."
    f = Finding(agent="claim", rule_id="c1", clause_citation="Claims §1", span=Span(start=11, end=35),
                quoted_text="best coffee in the world", confidence=0.9, severity="high", explanation="x")
    assert f.verify_span(text)
    f.span = Span(start=0, end=5)
    assert not f.verify_span(text)
