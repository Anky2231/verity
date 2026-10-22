"""Guideline ingestion: PDF/DOCX/TXT/MD -> text -> structured BIG draft for human review.

Deterministic and explainable: every item comes from a recognisable line, and anything we could not
classify is reported back as a note so the manager can fix it in the preview screen before publishing."""
import io
import re

SECTION = re.compile(r"^\s*(\d+)\.\s+(.{3,80})$")
CLAUSE = re.compile(r"^\s*(\d+\.\d+)\s+(.+)$")
BULLET = re.compile(r"^\s*[-•*]\s+(.+)$")
QUOTED = re.compile(r"[\"“”']([^\"“”']{2,60})[\"“”']")
SRC = re.compile(r"\s*\(([^()]+?),\s*p\.?\s*(\d+)\)\s*$")
NEG = re.compile(r"\b(never|not|instead of|avoid|don't|do not)\b", re.IGNORECASE)


def read_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages)
    if name.endswith(".docx"):
        from docx import Document
        doc = Document(io.BytesIO(data))
        lines = [p.text for p in doc.paragraphs]
        for t in doc.tables:
            lines += [" | ".join(c.text.strip() for c in row.cells) for row in t.rows]
        return "\n".join(lines)
    if name.endswith((".txt", ".md", ".markdown")):
        return data.decode("utf-8", errors="replace")
    raise ValueError("unsupported file type (use PDF, DOCX, TXT or MD)")


def _kind(heading: str) -> str:
    h = heading.lower()
    if any(w in h for w in ("voice", "tone", "style")):
        return "tone"
    if any(w in h for w in ("terminolog", "language", "word", "glossary")):
        return "term"
    if "claim" in h:
        return "claim"
    return "other"


def extract_big(text: str, brand_id: str = "brand", version: int = 1) -> tuple[dict, list[str]]:
    rules, glossary, claims, notes = [], [], [], []
    descriptors, do_ex, dont_ex = [], [], []
    kind, label, in_claims = "other", "General", False
    counters = {"tone": 0, "claim": 0, "other": 0}
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if re.match(r"^approved claims\s*:?$", line, re.IGNORECASE):
            in_claims = True
            continue
        if (m := SECTION.match(line)):
            kind, label, in_claims = _kind(m.group(2)), m.group(2).split()[0].capitalize(), False
            continue
        if in_claims and (m := BULLET.match(line)):
            body, source, page = m.group(1), None, None
            if (s := SRC.search(body)):
                body, source, page = body[:s.start()].strip(), s.group(1).strip(), int(s.group(2))
            else:
                notes.append(f"Claim without a source document/page: “{body[:60]}”. Add one before publishing.")
            claims.append({"id": f"c_{len(claims) + 1}", "text": body.rstrip("."), "source_doc": source or "Unknown source", "page": page})
            continue
        if (m := re.match(r"^do\s*:\s*(.+)$", line, re.IGNORECASE)):
            do_ex.append(m.group(1).strip().strip("\"“”")); continue
        if (m := re.match(r"^don[’']?t\s*:\s*(.+)$", line, re.IGNORECASE)):
            dont_ex.append(m.group(1).strip().strip("\"“”")); continue
        if (m := re.match(r"^our voice is\s+(.+?)\.?$", line, re.IGNORECASE)):
            descriptors = [d.strip() for d in re.split(r",\s*(?:and\s+)?|\s+and\s+", m.group(1)) if d.strip()]
            continue
        if (m := CLAUSE.match(line)):
            ref, body = f"{label} §{m.group(1)}", m.group(2).strip()
            quotes = [q.strip() for q in QUOTED.findall(body)]
            if kind == "term" and len(quotes) >= 2 and NEG.search(body):
                first_neg = NEG.search(body).start()
                approved = next((q for q in quotes if body.find(q) < first_neg), quotes[0])
                banned = [q for q in quotes if q != approved]
                rest = re.split(r"\.\s+", body, maxsplit=1)
                reason = (rest[1].strip() if len(rest) > 1 else "Not an approved term.").rstrip(".") + f" ({ref})."
                glossary.append({"id": f"t_{len(glossary) + 1}", "approved": approved, "banned": banned, "reason": reason})
                continue
            rtype = kind if kind in ("tone", "claim") else ("claim" if re.search(r"claim|superlative", body, re.I) else "tone")
            if kind == "other":
                notes.append(f"Clause {ref} sits under a section we could not classify; guessed type “{rtype}”. Check it.")
            counters[rtype] += 1
            sev = "high" if rtype == "claim" else ("low" if re.search(r"exclamation|all-caps|capital", body, re.I) else "medium")
            rid = f"r_{'voice' if rtype == 'tone' else 'claim'}_{counters[rtype]}"
            rules.append({"id": rid, "clause_ref": ref, "type": rtype, "severity": sev, "text": body})
            continue
        if kind != "other" and len(line) > 25:
            notes.append(f"Line not recognised as a rule, term or claim: “{line[:70]}”.")
    if not glossary:
        notes.append("No terminology entries found. Terminology clauses should look like: Say \"X\", never \"Y\" or \"Z\".")
    if not claims:
        notes.append("No approved claims found. ClaimGuard will flag every claim-like sentence until some are added.")
    if not rules:
        notes.append("No rules found. Rule clauses should be numbered, e.g. 1.2 Write in a warm voice.")
    big = {"brand_id": brand_id, "version": version,
           "tone_profile": {"descriptors": descriptors, "do_examples": do_ex, "dont_examples": dont_ex},
           "rules": rules, "glossary": glossary, "claims": claims}
    return big, notes
