"""MetaAgent: merge overlapping findings, rank, score."""
from .models import Finding, Span

SEV_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1}
SEV_PENALTY = {"critical": 20, "high": 12, "medium": 6, "low": 2}


def merge(findings: list[Finding]) -> list[dict]:
    """Group findings whose spans overlap. Each group becomes one highlight with consolidated reasons."""
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
                  for f in findings if not f.span)
    return sorted(merged, key=lambda m: (-SEV_RANK[m["severity"]], m["span"]["start"] if m["span"] else 0))


def score(findings: list[Finding], low_conf: float = 0.6, calibration: dict | None = None) -> int:
    """Only violations count; findings under the (per-rule) cutoff are suggestions and are not penalised."""
    cut = calibration or {}
    penalty = sum(SEV_PENALTY[f.severity] * f.confidence for f in findings if f.confidence >= cut.get(f.rule_id, low_conf))
    return max(0, round(100 - penalty))


def summary(highlights: list[dict], sc: int) -> str:
    if not highlights:
        return "No issues found."
    top = highlights[0]
    return (f"{len(highlights)} issue(s). Score {sc}/100. Prioritised by severity then confidence; "
            f"most serious: {top['severity']} ({', '.join(top['agents'])}).")
