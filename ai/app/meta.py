"""MetaAgent: merge overlapping findings, rank, score."""
from .models import Finding, Span

SEV_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1}
SEV_PENALTY = {"critical": 20, "high": 12, "medium": 6, "low": 2}


def _group(findings: list[Finding]) -> tuple[list[list[Finding]], list[Finding]]:
    """Sort spanned findings and group the ones whose spans overlap (interval merge, O(n log n)).
    Returns (overlap groups, findings that have no span). Shared by merge() and score() so they cannot disagree."""
    spanned = sorted([f for f in findings if f.span], key=lambda f: (f.span.start, f.span.end))
    groups: list[list[Finding]] = []
    cur_end = -1
    for f in spanned:
        if groups and f.span.start < cur_end:
            groups[-1].append(f)
            cur_end = max(cur_end, f.span.end)
        else:
            groups.append([f])
            cur_end = f.span.end
    return groups, [f for f in findings if not f.span]


def merge(findings: list[Finding]) -> list[dict]:
    """One highlight per group of overlapping findings, with the reasons consolidated."""
    groups, unspanned = _group(findings)
    merged = []
    for g in groups:
        top = max(g, key=lambda f: (SEV_RANK[f.severity], f.confidence))
        merged.append({
            "span": Span(start=min(f.span.start for f in g), end=max(f.span.end for f in g)).model_dump(),
            "severity": top.severity,
            "agents": sorted({f.agent for f in g}),
            "findings": [f.model_dump() for f in sorted(g, key=lambda f: -SEV_RANK[f.severity])],
        })
    merged.extend({"span": None, "severity": f.severity, "agents": [f.agent], "findings": [f.model_dump()]}
                  for f in unspanned)
    return sorted(merged, key=lambda m: (-SEV_RANK[m["severity"]], m["span"]["start"] if m["span"] else 0))


def _penalty(f: Finding) -> float:
    return SEV_PENALTY[f.severity] * f.confidence


def score(findings: list[Finding], low_conf: float = 0.6, calibration: dict | None = None) -> int:
    """Compliance score out of 100. Each highlight costs once, at its worst violation, so two agents flagging the same
    words are not punished twice. Findings under the (per-rule) confidence cutoff are suggestions and cost nothing."""
    cut = calibration or {}
    groups, unspanned = _group(findings)
    is_violation = lambda f: f.confidence >= cut.get(f.rule_id, low_conf)  # noqa: E731
    penalty = sum(max((_penalty(f) for f in g if is_violation(f)), default=0.0) for g in groups)
    penalty += sum(_penalty(f) for f in unspanned if is_violation(f))
    return max(0, round(100 - penalty))


def summary(highlights: list[dict], sc: int) -> str:
    if not highlights:
        return "No issues found."
    top = highlights[0]
    return (f"{len(highlights)} issue(s). Score {sc}/100. Prioritised by severity then confidence; "
            f"most serious: {top['severity']} ({', '.join(top['agents'])}).")
