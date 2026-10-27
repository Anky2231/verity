"""Brand contamination: wording that belongs to another brand the same people also work on.

An agency writer who moves from one client to another carries habits with them: the other client's product words, its
claims, or even its name. The gateway sends the *other* brands the user belongs to as `big["other_brands"]`
(approved terms, claims, tone examples). This module flags text that reads like one of them and not like the brand
being checked. It is deterministic and uses the same matching as the other agents, so it costs nothing and cannot
hallucinate. Findings use agent "brand" and rule ids of the form xb_<brand>_<item>.
"""
import re
from ..models import Finding, Span
from ..retrieval import Retriever
from .claim import _sentences

NAME_CONFIDENCE = 0.92
CLAIM_CONFIDENCE = 0.85
PHRASE_CONFIDENCE = 0.80       # a multi-word approved term of another brand
WORD_CONFIDENCE = 0.62         # a single word: could simply be shared vocabulary, so it stays a suggestion by default
EXAMPLE_CONFIDENCE = 0.70
CLAIM_COVERAGE = 0.60          # share of another brand's claim a sentence must repeat
OWN_COVERAGE = 0.35            # if the sentence also matches one of this brand's own claims, it is not foreign
EXAMPLE_COVERAGE = 0.70


def _phrase(p: str) -> re.Pattern:
    words = [re.escape(w) for w in re.split(r"[\s\-]+", p.strip().lower()) if w]
    return re.compile(r"(?<!\w)" + r"[\s\-]+".join(words) + r"(?:e?s)?(?!\w)", re.IGNORECASE)


def _own_vocabulary(big: dict) -> set[str]:
    """Phrases this brand itself uses; wording found here is never reported as foreign."""
    own = {g["approved"].lower() for g in big.get("glossary", []) if g.get("approved")}
    own |= {w.lower() for g in big.get("glossary", []) for w in g.get("allowed_contexts", [])}
    return own


def run(text: str, big: dict) -> list[Finding]:
    others = big.get("other_brands") or []
    if not others:
        return []
    own_name = (big.get("brand_name") or big.get("brand_id") or "this brand")
    own_vocab = _own_vocabulary(big)
    own_claims = Retriever(big.get("claims", []))
    findings: list[Finding] = []
    claimed: set[tuple[int, int]] = set()

    def add(brand, item_id, cite, m_start, m_end, quote, conf, severity, why):
        key = (m_start, m_end)
        if key in claimed:
            return
        claimed.add(key)
        findings.append(Finding(
            agent="brand", rule_id=f"xb_{brand['id']}_{item_id}", clause_citation=f"Other brand: {brand['name']} ({cite})",
            span=Span(start=m_start, end=m_end), quoted_text=quote, confidence=conf, severity=severity,
            explanation=why, suggestion=f"Rewrite in the {own_name} voice, using its approved wording."))

    for brand in others:
        name = brand["name"]
        # 1. The other brand's name (or its distinctive first word) appearing in this brand's content.
        first = name.split()[0]
        for label in {name, first}:
            if len(label) < 4 or label.lower() in own_name.lower():
                continue
            for m in re.finditer(rf"(?<!\w){re.escape(label)}(?!\w)", text, flags=re.IGNORECASE):
                add(brand, "name", "brand name", m.start(), m.end(), m.group(0), NAME_CONFIDENCE, "high",
                    f"'{m.group(0)}' is the name of {name}, a different brand. It should not appear in {own_name} content.")
        # 2. The other brand's approved terms.
        for t in brand.get("terms", []):
            approved = t.get("approved", "")
            if not approved or approved.lower() in own_vocab:
                continue
            multi = len(re.split(r"[\s\-]+", approved.strip())) > 1
            for m in _phrase(approved).finditer(text):
                add(brand, t.get("id", "term"), "terminology", m.start(), m.end(), m.group(0),
                    PHRASE_CONFIDENCE if multi else WORD_CONFIDENCE, "medium",
                    f"'{m.group(0)}' is approved wording for {name}, not {own_name}. It may have slipped in from {name} content.")
        # 3. Sentences that repeat one of the other brand's approved claims, and are not one of this brand's own.
        theirs = Retriever(brand.get("claims", []))
        for start, sent in _sentences(text):
            top = theirs.search(sent, k=1)
            if not top or top[0].coverage < CLAIM_COVERAGE:
                continue
            mine = own_claims.search(sent, k=1)
            if mine and mine[0].coverage >= OWN_COVERAGE:
                continue
            quote = sent.rstrip(" .!?") or sent
            c = top[0].claim
            add(brand, c.get("id", "claim"), "claims register", start, start + len(quote), quote, CLAIM_CONFIDENCE, "high",
                f"This repeats {name}'s approved claim {c.get('id', '')} ('{c.get('text', '')}'), which {own_name} has not approved.")
        # 4. Sentences that echo the other brand's tone examples.
        examples = Retriever([{"id": f"e{i}", "text": e} for i, e in enumerate(brand.get("examples", []))])
        for start, sent in _sentences(text):
            top = examples.search(sent, k=1)
            if top and top[0].coverage >= EXAMPLE_COVERAGE:
                quote = sent.rstrip(" .!?") or sent
                add(brand, top[0].claim["id"], "tone example", start, start + len(quote), quote, EXAMPLE_CONFIDENCE, "medium",
                    f"This closely echoes a writing example from {name}'s guidelines, not {own_name}'s.")
    return findings
