"""Span integrity. LLMs are unreliable at character offsets, so agents return quoted_text
and we compute/verify offsets here. A finding whose quote can't be located is dropped."""
import re
import unicodedata
from .models import Finding, Span


def normalise(text: str) -> str:
    """Normalise ONCE at ingestion; all offsets refer to this string."""
    return unicodedata.normalize("NFC", text.replace("\r\n", "\n"))


def locate(text: str, quote: str, hint_start: int | None = None) -> Span | None:
    """Find quote in text. If it occurs several times, prefer the occurrence nearest hint_start."""
    if not quote:
        return None
    starts = [m.start() for m in re.finditer(re.escape(quote), text)]
    if not starts:
        starts = [m.start() for m in re.finditer(re.escape(quote), text, flags=re.IGNORECASE)]
    if not starts:
        return None
    s = min(starts, key=lambda x: abs(x - hint_start)) if hint_start is not None else starts[0]
    return Span(start=s, end=s + len(quote))


def repair_findings(text: str, findings: list[Finding]) -> tuple[list[Finding], int]:
    """Return (valid findings, dropped count). Fixes wrong offsets by re-locating the quote."""
    out, dropped = [], 0
    for f in findings:
        if f.verify_span(text):
            out.append(f)
            continue
        span = locate(text, f.quoted_text, f.span.start if f.span else None)
        if span is None:
            dropped += 1
            continue
        f.span = span
        f.quoted_text = text[span.start:span.end]  # keep exact casing from source
        out.append(f)
    return out, dropped
