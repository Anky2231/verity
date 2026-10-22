"""TermGuard: deterministic glossary enforcement (fast, zero hallucination)."""
import re
from ..models import Finding, Span


def run(text: str, big: dict) -> list[Finding]:
    findings = []
    for entry in big.get("glossary", []):
        for banned in entry["banned"]:
            for m in re.finditer(rf"\b{re.escape(banned)}\b", text, flags=re.IGNORECASE):
                findings.append(Finding(
                    agent="term", rule_id=entry["id"], clause_citation=entry.get("reason", "Terminology"),
                    span=Span(start=m.start(), end=m.end()), quoted_text=m.group(0),
                    confidence=0.95, severity="medium",
                    explanation=f"'{m.group(0)}' is not an approved term. {entry.get('reason', '')}".strip(),
                    suggestion=entry["approved"], replacement=entry["approved"]))
    return findings
