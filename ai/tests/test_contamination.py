from app.agents import contamination

LUMINA = {"id": "lumina", "name": "Lumina Coffee Co.",
          "terms": [{"id": "t_1", "approved": "coffee beans"}, {"id": "t_2", "approved": "customers"}],
          "claims": [{"id": "c_3", "text": "Roasted in small batches within 48 hours of shipping"}],
          "examples": ["Our roasters pick every batch by hand."]}
NORTHWIND = {"brand_id": "northwind", "brand_name": "Northwind Tea Co.", "other_brands": [LUMINA],
             "glossary": [{"id": "t_1", "approved": "tea leaves", "banned": ["tea bags"]}],
             "claims": [{"id": "c_1", "text": "Our leaves are picked by hand on two family estates in Darjeeling"}]}


def run(text, big=NORTHWIND):
    return contamination.run(text, big)


def test_nothing_to_check_without_other_brands():
    assert contamination.run("Our coffee beans are roasted.", {"brand_id": "x"}) == []


def test_other_brands_approved_phrase_is_flagged_with_its_span():
    text = "Our new tin holds the finest coffee beans for slow mornings."
    f = run(text)
    assert len(f) == 1 and f[0].agent == "brand" and f[0].quoted_text == "coffee beans"
    assert text[f[0].span.start:f[0].span.end] == "coffee beans"
    assert f[0].rule_id == "xb_lumina_t_1" and "Lumina Coffee Co." in f[0].clause_citation
    assert f[0].confidence == contamination.PHRASE_CONFIDENCE


def test_single_shared_word_is_low_confidence():
    f = run("We are grateful to our customers.")
    assert [x.quoted_text for x in f] == ["customers"] and f[0].confidence == contamination.WORD_CONFIDENCE


def test_the_other_brands_name_is_a_high_confidence_finding():
    f = run("Inspired by our friends at Lumina.")
    assert f[0].quoted_text == "Lumina" and f[0].severity == "high" and f[0].confidence == contamination.NAME_CONFIDENCE


def test_other_brands_claim_is_flagged_but_own_claim_is_not():
    foreign = run("Everything is roasted in small batches within 48 hours of shipping.")
    assert any("claims register" in x.clause_citation for x in foreign)
    own = run("Our leaves are picked by hand on two family estates in Darjeeling.")
    assert own == []


def test_tone_example_echo_is_flagged():
    f = run("Our roasters pick every batch by hand.")
    assert any("tone example" in x.clause_citation for x in f)


def test_own_vocabulary_is_never_foreign():
    big = {**NORTHWIND, "glossary": [{"id": "t_1", "approved": "coffee beans", "banned": ["java"]}]}
    assert contamination.run("We also sell coffee beans.", big) == []


def test_clean_content_has_no_findings():
    assert run("Steep for three minutes and notice the colour change. Our leaves are picked by hand.") == []


def test_overlapping_matches_report_once():
    f = run("Visit Lumina for coffee beans.")
    spans = [(x.span.start, x.span.end) for x in f]
    assert len(spans) == len(set(spans))


def test_full_review_reports_brand_findings_and_they_lower_the_score():
    import asyncio
    from app import pipeline
    text = "Our new tin holds the finest coffee beans."
    with_other = asyncio.run(pipeline.review(text, NORTHWIND))
    without = asyncio.run(pipeline.review(text, {k: v for k, v in NORTHWIND.items() if k != "other_brands"}))
    agents = [f["agent"] for h in with_other["highlights"] for f in h["findings"]]
    assert "brand" in agents
    assert with_other["score"] < without["score"]
