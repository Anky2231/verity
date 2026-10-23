from app.agents import term
from app.sample_brand import SAMPLE_BIG


def run(text, big=SAMPLE_BIG):
    return term.run(text, big)


def pairs(text, big=SAMPLE_BIG):
    return [(f.quoted_text, f.replacement) for f in run(text, big)]


def test_exact_listed_terms_still_match_with_high_confidence():
    f = run("Grab your morning java at Lumina.")
    assert [(x.quoted_text, x.confidence) for x in f] == [("java", 0.95)]


def test_singular_and_plural_variants_are_caught_with_lower_confidence():
    assert pairs("Our consumer base loves it.") == [("consumer", "customer")]          # approved wording follows the singular
    f = run("Consumers love it.")
    assert [(x.quoted_text, x.replacement, x.confidence) for x in f] == [("Consumers", "Customers", 0.95)]
    f = run("A bargain bean blend.")
    assert [(x.quoted_text, x.replacement, x.confidence) for x in f] == [("bargain bean", "ethically sourced", 0.85)]


def test_hyphen_dash_and_extra_space_variants_of_multi_word_terms():
    for text, quoted in [("Try cheap-beans today.", "cheap-beans"), ("Try cheap  beans today.", "cheap  beans"), ("Try cheap–beans today.", "cheap–beans")]:
        assert [x.quoted_text for x in run(text)] == [quoted]


def test_replacement_keeps_the_capitalisation_of_the_match():
    assert pairs("Consumers first.") == [("Consumers", "Customers")]
    assert pairs("CONSUMERS FIRST") == [("CONSUMERS", "CUSTOMERS")]
    assert pairs("our consumers") == [("consumers", "customers")]


def test_possessives_are_matched_and_the_span_is_exact():
    f = run("Java's rich aroma.")
    assert [(x.quoted_text, x.span.start, x.span.end) for x in f] == [("Java", 0, 4)]


def test_words_that_only_contain_a_banned_term_are_not_flagged():
    for text in ["Consumerism is rising.", "The javascript file loaded.", "Enjoy a joey the kangaroo.", "Join us, usersly."]:
        assert run(text) == [], text


def test_allowed_contexts_suppress_a_match_only_inside_that_phrase():
    big = {"glossary": [{"id": "t_1", "approved": "coffee beans", "banned": ["java"], "reason": "slang",
                         "allowed_contexts": ["Java developers", "Joe's Diner"]}]}
    assert run("Java developers meet on Friday.", big) == []
    assert [x.quoted_text for x in run("Java developers love java.", big)] == ["java"]   # the second use is still slang
    assert run("Meet at JAVA DEVELOPERS night.", big) == []                               # case-insensitive
    big["glossary"][0]["banned"] = ["joe"]
    assert run("Meet us at Joe’s Diner.", big) == []                                  # curly apostrophe works too
    assert [x.quoted_text for x in run("Joe loves it.", big)] == ["Joe"]


def test_two_listed_variants_matching_the_same_words_give_one_finding():
    big = {"glossary": [{"id": "t_2", "approved": "customers", "banned": ["user", "users"], "reason": "r"}]}
    assert len(run("Our users love it.", big)) == 1


def test_a_glossary_entry_without_allowed_contexts_or_banned_words_is_safe():
    assert run("anything", {"glossary": []}) == []
    assert run("anything", {}) == []


def test_replacement_is_capitalised_only_at_the_start_of_a_sentence():
    assert pairs("Consumers first.") == [("Consumers", "Customers")]
    assert pairs("Hello. Consumers first.") == [("Consumers", "Customers")]                 # after a full stop
    assert pairs('She said: "Consumers first."') == [("Consumers", "Customers")]           # after an opening quote
    assert pairs("We love Java at the cafe.") == [("Java", "coffee beans")]                  # mid-sentence capital stays lower case
    assert pairs("Meet Joe at noon.") == [("Joe", "coffee beans")]


def test_hyphen_spelling_keeps_full_confidence_but_unlisted_plural_forms_do_not():
    assert [x.confidence for x in run("Try cheap-beans.")] == [0.95]
    assert [x.confidence for x in run("Our consumer base.")] == [0.85]
