"""Ranked retrieval over the approved claims register.

Scores a sentence against each approved claim with BM25 for ranking, then measures how much of the best
claim the sentence actually covers (IDF-weighted, with light stemming and typo-tolerant token matching).
Numbers are checked separately: "within 24 hours" never counts as supported by "within 48 hours".

The interface (Retriever.search -> list[Match]) is deliberately small so an embedding index (pgvector)
can replace the scoring later without touching ClaimGuard."""
import math
import re
from dataclasses import dataclass
from difflib import SequenceMatcher

STOP = {"the", "a", "an", "of", "in", "to", "and", "is", "are", "we", "our", "all", "every", "your", "it", "its",
        "at", "on", "for", "with", "by", "as", "be", "this", "that", "us", "from", "you", "has", "have", "any"}
FUZZY = 0.84  # similarity at which two words count as the same (catches typos like compostible)
K1, B = 1.5, 0.75


def stem(w: str) -> str:
    if w[0].isdigit():
        return w
    for suf in ("ing", "ed", "es", "s", "ly"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            w = w[: -len(suf)]
            break
    return w[:-1] if len(w) > 3 and w[-1] == w[-2] and w[-1] not in "aeiou" else w  # shipp -> ship


def tokens(s: str) -> list[str]:
    return [stem(w) for w in re.findall(r"[a-z0-9%]+", s.lower()) if w not in STOP]


def _numbers(toks: list[str]) -> set[str]:
    return {t for t in toks if t[0].isdigit()}


def _same(a: str, b: str) -> bool:
    if a == b:
        return True
    if a[0].isdigit() or b[0].isdigit():
        return False  # numbers must match exactly
    return SequenceMatcher(None, a, b).ratio() >= FUZZY


@dataclass
class Match:
    claim: dict
    bm25: float
    coverage: float     # 0..1: share of the claim's (weighted) words found in the sentence
    conflict: str | None  # e.g. "48 vs 24" when the numbers disagree


class Retriever:
    def __init__(self, claims: list[dict]):
        self.claims = claims
        self.docs = [tokens(c["text"]) for c in claims]
        n = len(self.docs)
        self.avg = (sum(len(d) for d in self.docs) / n) if n else 0.0
        df: dict[str, int] = {}
        for d in self.docs:
            for t in set(d):
                df[t] = df.get(t, 0) + 1
        self.idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}

    def _bm25(self, q: list[str], doc: list[str]) -> float:
        score = 0.0
        for t in set(q):
            f = sum(1 for d in doc if _same(t, d))
            if f:
                idf = self.idf.get(t) or max((self.idf.get(d, 0) for d in doc if _same(t, d)), default=0)
                score += idf * f * (K1 + 1) / (f + K1 * (1 - B + B * len(doc) / (self.avg or 1)))
        return score

    def search(self, sentence: str, k: int = 3) -> list[Match]:
        q = tokens(sentence)
        out = []
        for claim, doc in zip(self.claims, self.docs):
            if not doc:
                continue
            total = sum(self.idf.get(t, 1.0) for t in doc) or 1.0
            hit = sum(self.idf.get(t, 1.0) for t in doc if any(_same(t, x) for x in q))
            cn, qn = _numbers(doc), _numbers(q)
            conflict = None
            if cn and qn and not (cn <= qn):
                conflict = f"{', '.join(sorted(cn))} vs {', '.join(sorted(qn))}"
            elif qn - cn and cn:
                conflict = f"{', '.join(sorted(cn))} vs {', '.join(sorted(qn))}"
            out.append(Match(claim, self._bm25(q, doc), hit / total, conflict))
        return sorted(out, key=lambda m: (-m.coverage, -m.bm25))[:k]
