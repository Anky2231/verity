"""Experiment: would character n-gram (lexical) vectors improve ClaimGuard's support decision over the current
coverage + number-conflict check? Result on our data: no. Kept so the conclusion can be reproduced.

Run: .venv/bin/python scripts/vector_experiment.py
"""
import json, math, re, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from collections import Counter
from app.sample_brand import SAMPLE_BIG
from app.retrieval import Retriever
from app.agents.claim import _sentences, CLAIM_PATTERNS

# --- candidate: hashed character n-gram TF-IDF vectors, cosine similarity (pure Python) ---
def grams(s, ns=(3, 4, 5)):
    s = " " + re.sub(r"[^a-z0-9%]+", " ", s.lower()).strip() + " "
    out = Counter()
    for n in ns:
        for i in range(len(s) - n + 1): out[s[i:i+n]] += 1
    return out
claims = SAMPLE_BIG["claims"]
docs = [grams(c["text"]) for c in claims]
df = Counter(g for d in docs for g in d); N = len(docs)
idf = lambda g: math.log(1 + (N + 1) / (df.get(g, 0) + 1))
def vec(c): return {g: (1 + math.log(v)) * idf(g) for g, v in c.items()}
def cos(a, b):
    num = sum(a[g] * b.get(g, 0) for g in a); da = math.sqrt(sum(x*x for x in a.values())); db = math.sqrt(sum(x*x for x in b.values()))
    return num / (da * db) if da and db else 0.0
cv = [vec(d) for d in docs]
R = Retriever(claims)

rows = []
for name, fn in (("dev", "dataset.json"), ("heldout", "heldout.json")):
    for it in json.load(open(f"eval/{fn}")):
        flagged_exp = {e["quote"].lower() for e in it["expected"] if e["agent"] == "claim"}
        for start, sent in _sentences(it["text"]):
            if not CLAIM_PATTERNS.search(sent): continue
            m = R.search(sent, k=1)[0]
            q = vec(grams(sent)); sims = [cos(q, v) for v in cv]; best = max(sims)
            should_flag = any(e in sent.lower() or sent.lower().rstrip(' .!?') in e for e in flagged_exp)
            rows.append((name, sent, should_flag, round(m.coverage, 2), m.conflict is not None, round(best, 2)))
# --- verdict: how well does each signal separate "supported" from "should be flagged"? ---
def best_threshold_accuracy(values_and_labels):
    """Best accuracy of a single rule 'flag if value < t', over every possible t."""
    pts = sorted({v for v, _ in values_and_labels} | {2.0})
    return max(sum((v < t) == flag for v, flag in values_and_labels) for t in pts)

n = len(rows)
by_rule = sum(((r[3] < 0.75) or r[4]) == r[2] for r in rows)                  # what ClaimGuard does today
by_cos = best_threshold_accuracy([(r[5], r[2]) for r in rows])               # the best a cosine threshold could do
by_cov = best_threshold_accuracy([(r[3], r[2]) for r in rows])
print(f"{n} claim-like sentences (dev + held-out)")
print(f"  current rule (coverage < 0.75 or number conflict): {by_rule}/{n} correct")
print(f"  best possible single threshold on coverage alone : {by_cov}/{n}")
print(f"  best possible single threshold on char n-gram cosine: {by_cos}/{n}")
print("Verdict:", "vectors would not help" if by_cos <= by_rule else "vectors look worth a closer look")
