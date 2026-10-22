from app.agents import claim
from app.retrieval import Retriever, stem, tokens
from app.sample_brand import SAMPLE_BIG

CLAIMS = SAMPLE_BIG["claims"]


def test_stemming_unifies_word_forms():
    assert stem("roasted") == stem("roasting") == "roast"
    assert stem("shipping") == "ship" and stem("batches") == "batch" and stem("48") == "48"


def test_tokens_drop_stopwords_and_keep_numbers_and_percent():
    assert tokens("All packaging is 100% compostable") == ["packag", "100%", "compostable"]


def test_retrieval_ranks_the_right_claim_first():
    r = Retriever(CLAIMS)
    assert r.search("We roast in small batches and ship within 48 hours")[0].claim["id"] == "c_3"
    assert r.search("Our packaging is compostable")[0].claim["id"] == "c_2"
    assert r.search("Sourced directly from our partner farms")[0].claim["id"] == "c_1"


def test_typo_and_reordering_still_count_as_supported():
    assert claim.run("All packaging is 100% compostible.", SAMPLE_BIG) == []
    assert claim.run("100% of our packaging is compostable.", SAMPLE_BIG) == []
    assert claim.run("We roast in small batches and ship within 48 hours of an order.", SAMPLE_BIG) == []


def test_wrong_number_is_a_conflict_even_when_the_words_match():
    f = claim.run("Roasted in small batches within 24 hours of shipping.", SAMPLE_BIG)
    assert len(f) == 1 and f[0].confidence == 0.9 and "numbers differ" in f[0].explanation
    assert f[0].replacement == "Roasted in small batches within 48 hours of shipping"
    assert f[0].source_ref.startswith("c_3")


def test_swapped_key_word_is_not_supported():
    f = claim.run("All packaging is 100% recyclable.", SAMPLE_BIG)
    assert len(f) == 1 and "c_2" in f[0].explanation


def test_percentage_statements_are_recognised_as_claims():
    for s in ("Every cup is 100% carbon neutral.", "Over 90% of customers prefer our dark roast."):
        f = claim.run(s, SAMPLE_BIG)
        assert len(f) == 1 and "No approved claim" in f[0].explanation and f[0].replacement is None


def test_no_claims_register_flags_every_claim_and_never_crashes():
    big = {**SAMPLE_BIG, "claims": []}
    assert len(claim.run("We guarantee the best coffee.", big)) == 1
    assert Retriever([]).search("anything") == []
