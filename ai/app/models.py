"""Mirrors /schemas/finding.schema.json. Keep in sync."""
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator

Agent = Literal["tone", "term", "claim", "brand", "visual", "access", "manual"]
Severity = Literal["low", "medium", "high", "critical"]


class Span(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)


class Finding(BaseModel):
    agent: Agent
    rule_id: str
    clause_citation: str
    span: Optional[Span] = None
    region: Optional[dict] = None  # image bounding box (Round 3 VisualGuard); text findings use span
    quoted_text: str
    confidence: float = Field(ge=0, le=1)
    severity: Severity
    explanation: str
    suggestion: Optional[str] = None
    replacement: Optional[str] = None  # literal text safe to substitute for quoted_text
    source_ref: Optional[str] = None
    kind: Literal["violation", "suggestion"] = "violation"  # low-confidence findings are suggestions

    def verify_span(self, text: str) -> bool:
        """Span integrity: text[start:end] must equal quoted_text."""
        return bool(self.span) and text[self.span.start:self.span.end] == self.quoted_text


class ReviewRequest(BaseModel):
    revision_id: str
    brand_id: str
    big_version: int = 1
    content_type: str = "blog"
    text: str
    big: Optional[dict] = None  # BIG supplied by the gateway; falls back to the sample brand
    calibration: dict[str, float] = {}  # per-rule confidence cutoffs learned from reviewer overrides

    @model_validator(mode="after")
    def non_empty(self):
        if not self.text.strip():
            raise ValueError("text is empty")
        return self


class AgentResult(BaseModel):
    agent: Agent
    status: Literal["ok", "failed"]
    findings: list[Finding] = []
    latency_ms: int = 0
    retries: int = 0
    error: Optional[str] = None
    mode: str = "rules"
    dropped: int = 0
    model: Optional[str] = None
    tokens: Optional[dict] = None
