"""ClaimGuard: finds claim-like sentences and checks them against the approved claims register.
Retrieval is token-overlap for now; swap in pgvector similarity later (same interface)."""
import re
from ..models import Finding, Span

CLAIM_PATTERNS = re.compile(
    r"\b(best|#1|number one|leading|market-leading|best in class|guarantee[ds]?|proven|only|"
    r"\d+(\.\d+)?\s?%|\d+\s?(hours?|days?|farms?)|compostable|sustainable|organic)\b", re.IGNORECASE)
_STOP = {"the", "a", "an", "of", "in", "to", "and", "is", "are", "we", "our", "all", "every", "your"}


def _tokens(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9%]+", s.lower()) if w not in _STOP}


def _sentences(text: str):
    for m in re.finditer(r"[^.!?]+[.!?]*", text):
        s = m.group(0)
        if s.strip():
            lead = len(s) - len(s.lstrip())
            yield m.start() + lead, s.strip()


def best_support(sentence: str, claims: list[dict]) -> tuple[dict | None, float]:
    toks = _tokens(sentence)
    best, score = None, 0.0
    for c in claims:
        ct = _tokens(c["text"])
        if not ct:
            continue
        overlap = len(toks & ct) / len(ct)
        if overlap > score:
            best, score = c, overlap
    return best, score


def run(text: str, big: dict, support_threshold: float = 0.6) -> list[Finding]:
    findings = []
    for start, sent in _sentences(text):
        if not CLAIM_PATTERNS.search(sent):
            continue
        claim, score = best_support(sent, big.get("claims", []))
        if claim and score >= support_threshold:
            continue  # supported by an approved claim
        quote = sent.rstrip(" .!?") or sent
        findings.append(Finding(
            agent="claim", rule_id="r_claim_1", clause_citation="Claims §3.1",
            span=Span(start=start, end=start + len(quote)), quoted_text=quote,
            confidence=0.85 if not claim else 0.65, severity="high",
            explanation=("No approved claim supports this statement." if not claim else
                         f"Only partially matches approved claim '{claim['text']}'."),
            suggestion=(f"Use approved wording: \"{claim['text']}\"" if claim else
                        "Remove the claim or have Legal add it to the approved claims register."),
            replacement=(claim["text"] if claim else None),
            source_ref=(f"{claim['id']} · {claim['source_doc']} p.{claim.get('page')}" if claim else None)))
    return findings
