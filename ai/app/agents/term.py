"""TermGuard: deterministic glossary enforcement (fast, zero hallucination).

Beyond exact matches it recognises the obvious variants of a banned term: singular/plural, hyphen, dash or extra-space
spellings of multi-word terms ("cheap-beans", "cheap  beans", "bargain bean"). A hyphen or spacing difference is the same
term, so it keeps the full confidence; a singular or plural form the brand did not list is reported at 0.85 instead
of 0.95. A glossary entry may also carry `allowed_contexts`: phrases in which the word is fine ("Java developers"),
so a banned slang word is not flagged when it means something else.
"""
import re
from ..models import Finding, Span
from . import contamination

EXACT_CONFIDENCE = 0.95
VARIANT_CONFIDENCE = 0.85
_SEP = r"[\s\-‐-―]+"          # spaces, hyphens and dashes between the words of a term
_APOS = re.compile(r"['’]")


def _word(word: str, inflect: bool) -> str:
    w = word.lower()
    if inflect and len(w) > 3 and w.isalpha():
        base = w[:-1] if w.endswith("s") and not w.endswith("ss") else w
        return re.escape(base) + r"(?:e?s)?"
    return re.escape(w)


def _pattern(banned: str) -> re.Pattern:
    words = [w for w in re.split(r"[\s\-‐-―]+", banned.strip()) if w]
    parts = [_word(w, inflect=(i == len(words) - 1)) for i, w in enumerate(words)]   # only the last word inflects
    return re.compile(r"(?<!\w)" + _SEP.join(parts) + r"(?!\w)", re.IGNORECASE)


def _norm(s: str) -> str:
    return re.sub(_SEP, " ", s.strip().lower())


def _is_plural(word: str) -> bool:
    w = word.lower().rstrip()
    return len(w) > 3 and w.endswith("s") and not w.endswith("ss")


def _starts_sentence(text: str, pos: int) -> bool:
    before = text[:pos].rstrip(" \t\"'\u201c\u2018(")
    return not before or before[-1] in ".!?:\n"


def _replacement(matched: str, listed: str, approved: str, sentence_start: bool = True) -> str:
    """Approved wording, adjusted to the match: capitalised only at the start of a sentence (or all caps when the
    writer shouted), and singular where the writer used singular. A capital in mid-sentence, as in 'Java', is not a
    reason to capitalise the replacement."""
    out = approved
    if _is_plural(listed) and not _is_plural(matched) and _is_plural(approved):
        out = approved[:-1]
    elif not _is_plural(listed) and _is_plural(matched) and not _is_plural(approved):
        out = approved + "s"
    if len(matched) > 1 and matched.isupper():
        return out.upper()
    if matched[:1].isupper() and sentence_start:
        return out[:1].upper() + out[1:]
    return out


def _allowed_spans(text: str, contexts: list[str]) -> list[tuple[int, int]]:
    spans = []
    for phrase in contexts:
        if not phrase.strip():
            continue
        pat = "".join(r"['’]" if _APOS.match(c) else re.escape(c) for c in phrase.strip())
        spans += [(m.start(), m.end()) for m in re.finditer(rf"(?<!\w){pat}(?!\w)", text, flags=re.IGNORECASE)]
    return spans


def run(text: str, big: dict) -> list[Finding]:
    findings, seen = [], set()
    for entry in big.get("glossary", []):
        allowed = _allowed_spans(text, entry.get("allowed_contexts", []))
        for banned in entry["banned"]:
            for m in _pattern(banned).finditer(text):
                if any(a <= m.start() and m.end() <= b for a, b in allowed):
                    continue                                            # e.g. "Java" inside "Java developers"
                key = (m.start(), m.end(), entry["id"])
                if key in seen:
                    continue                                            # two listed variants matched the same words
                seen.add(key)
                exact = _norm(m.group(0)) == _norm(banned)
                findings.append(Finding(
                    agent="term", rule_id=entry["id"], clause_citation=entry.get("reason", "Terminology"),
                    span=Span(start=m.start(), end=m.end()), quoted_text=m.group(0),
                    confidence=EXACT_CONFIDENCE if exact else VARIANT_CONFIDENCE, severity="medium",
                    explanation=f"'{m.group(0)}' is not an approved term. {entry.get('reason', '')}".strip(),
                    suggestion=entry["approved"], replacement=_replacement(m.group(0), banned, entry["approved"], _starts_sentence(text, m.start()))))
    return findings + contamination.run(text, big)   # wording from the user's other brands, when the gateway sends them
