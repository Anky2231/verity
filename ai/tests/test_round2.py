import base64
import json
import os
from fastapi.testclient import TestClient
from app.main import app
from app.extract import extract_big, read_text
from app.pipeline import review
from app.sample_brand import INJECTION_CONTENT, SAMPLE_BIG, SAMPLE_CONTENT, SAMPLE_GUIDELINE_TEXT
import asyncio

client = TestClient(app)
SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "web", "public", "sample")


def test_extract_sample_text_yields_rules_terms_claims_and_tone():
    big, notes = extract_big(SAMPLE_GUIDELINE_TEXT, "lumina")
    assert [r["id"] for r in big["rules"]] == ["r_voice_1", "r_voice_2", "r_claim_1"]
    assert {g["approved"] for g in big["glossary"]} == {"coffee beans", "customers", "ethically sourced"}
    assert big["glossary"][0]["banned"] == ["java", "joe"]
    assert big["claims"][0]["source_doc"] == "Sourcing Report 2025" and big["claims"][0]["page"] == 4
    assert "warm" in big["tone_profile"]["descriptors"] and notes == []


def test_extract_reads_real_pdf_and_docx():
    for ext in ("pdf", "docx"):
        data = open(os.path.join(SAMPLE_DIR, f"lumina-brand-guidelines.{ext}"), "rb").read()
        big, _ = extract_big(read_text(f"g.{ext}", data), "lumina")
        assert len(big["rules"]) == 3 and len(big["glossary"]) == 3 and len(big["claims"]) == 3


def test_extract_reports_what_it_could_not_understand():
    big, notes = extract_big("Brand Book\n1. Voice\nBe nice to everybody always and forever in every channel.\nApproved claims:\n- We are great", "x")
    assert any("not recognised" in n for n in notes) and any("without a source" in n for n in notes)
    assert any("No terminology" in n for n in notes)


def test_extract_endpoint_validates_input():
    ok = client.post("/extract", json={"filename": "x.md", "use_sample": True})
    assert ok.status_code == 200 and len(ok.json()["big"]["rules"]) == 3
    bad_type = client.post("/extract", json={"filename": "x.exe", "content_base64": base64.b64encode(b"hi").decode()})
    assert bad_type.status_code == 422
    corrupt = client.post("/extract", json={"filename": "x.pdf", "content_base64": base64.b64encode(b"not a pdf").decode()})
    assert corrupt.status_code == 422
    empty = client.post("/extract", json={"filename": "x.txt", "content_base64": ""})
    assert empty.status_code == 422


def test_calibration_turns_overridden_rule_into_suggestion_and_stops_penalising():
    base = asyncio.run(review("We leverage synergistic roasting solutions.", SAMPLE_BIG))
    cal = asyncio.run(review("We leverage synergistic roasting solutions.", SAMPLE_BIG, calibration={"r_voice_1": 0.9}))
    f_base = base["highlights"][0]["findings"][0]; f_cal = cal["highlights"][0]["findings"][0]
    assert f_base["kind"] == "violation" and f_cal["kind"] == "suggestion"
    assert cal["score"] > base["score"] and cal["score"] == 100


def test_stream_emits_agent_events_then_done():
    r = client.post("/stream/review", json={"revision_id": "r", "brand_id": "b", "text": SAMPLE_CONTENT})
    events = [json.loads(line) for line in r.text.splitlines()]
    assert [e["event"] for e in events] == ["agent", "agent", "agent", "done"]
    assert {e["result"]["agent"] for e in events[:3]} == {"tone", "term", "claim"}
    assert events[-1]["result"]["timing"]["first_agent_ms"] is not None


def test_prompt_injection_sample_is_flagged_not_obeyed():
    res = asyncio.run(review(INJECTION_CONTENT, SAMPLE_BIG))
    quotes = {f["quoted_text"].lower() for h in res["highlights"] for f in h["findings"]}
    assert "java" in quotes and res["score"] < 100
