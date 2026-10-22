"""Runs all agents in parallel; one agent failing never blocks the others."""
import asyncio
import time
from .models import AgentResult, Finding
from .spans import normalise, repair_findings
from .agents import term, claim, tone
from . import meta

AGENT_TIMEOUT_S = 45


async def _run_agent(name: str, fn, text: str, big: dict) -> AgentResult:
    t0 = time.perf_counter()
    try:
        out = await asyncio.wait_for(asyncio.to_thread(fn, text, big), AGENT_TIMEOUT_S)
        findings, info = out if isinstance(out, tuple) else (out, {})
        findings, dropped = repair_findings(text, findings)
        return AgentResult(agent=name, status="ok", findings=findings, retries=info.get("retries", 0),
                           mode=info.get("mode", "rules"), dropped=dropped, model=info.get("model"), tokens=info.get("tokens"),
                           latency_ms=int((time.perf_counter() - t0) * 1000))
    except Exception as e:  # noqa: BLE001 - isolation is the point
        return AgentResult(agent=name, status="failed", error=str(e)[:200],
                           latency_ms=int((time.perf_counter() - t0) * 1000))


async def review(text: str, big: dict, on_agent_done=None, calibration: dict | None = None) -> dict:
    t_start = time.perf_counter()
    cut = calibration or {}
    text = normalise(text)
    agents = {"tone": tone.run, "term": term.run, "claim": claim.run}
    tasks = [asyncio.create_task(_run_agent(n, f, text, big)) for n, f in agents.items()]
    results: list[AgentResult] = []
    first_ms = None
    for coro in asyncio.as_completed(tasks):
        r = await coro
        results.append(r)
        first_ms = first_ms if first_ms is not None else int((time.perf_counter() - t_start) * 1000)
        if on_agent_done:  # hook for streaming partial results (Socket.IO/SSE) later
            await on_agent_done(r)
    all_findings: list[Finding] = [f for r in results for f in r.findings]
    for f in all_findings:  # low confidence (or a rule reviewers keep overriding) -> suggestion, not violation
        f.kind = "suggestion" if f.confidence < cut.get(f.rule_id, 0.6) else "violation"
    highlights = meta.merge(all_findings)
    sc = meta.score(all_findings, calibration=cut)
    return {"timing": {"first_agent_ms": first_ms, "total_ms": int((time.perf_counter() - t_start) * 1000)},
            "calibration": cut, "text": text, "score": sc, "summary": meta.summary(highlights, sc), "highlights": highlights,
            "agents": [r.model_dump() for r in sorted(results, key=lambda r: r.agent)]}
