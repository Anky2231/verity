import os
from fastapi import FastAPI, Header, HTTPException
from .models import ReviewRequest, AgentResult
from .pipeline import AGENTS, _run_agent, merge_results, review as run_review
import asyncio, base64, json
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from .extract import extract_big, read_text
from .spans import normalise
from .sample_brand import SAMPLE_BIG, SAMPLE_CONTENT, SAMPLES, SAMPLE_GUIDELINE_TEXT

app = FastAPI(title="Verity AI service")


def _auth(token: str | None):
    expected = os.getenv("AI_SERVICE_TOKEN")
    if expected and token != expected:
        raise HTTPException(status_code=401, detail="bad service token")


@app.get("/health")
def health():
    return {"ok": True, "service": "verity-ai", "llm_configured": bool(os.getenv("ANTHROPIC_API_KEY"))}


@app.post("/review/{agent}", response_model=AgentResult)
async def review(agent: str, req: ReviewRequest, x_service_token: str | None = Header(default=None)):
    """Run one review agent, preserving the same isolation and result contract as the pipeline."""
    _auth(x_service_token)
    if agent not in AGENTS:
        raise HTTPException(404, "unknown agent")
    # Normalise exactly as pipeline.review() does, so offsets match the text /merge returns.
    return await _run_agent(agent, getattr(AGENTS[agent], "run"), normalise(req.text), req.big or SAMPLE_BIG)


class MergeRequest(BaseModel):
    text: str
    agents: list[AgentResult]
    calibration: dict[str, float] = {}
    timing: dict = {"first_agent_ms": None, "total_ms": 0}


@app.post("/merge")
def merge(req: MergeRequest, x_service_token: str | None = Header(default=None)):
    """Merge the independent agent outputs using the pipeline's canonical MetaAgent logic."""
    _auth(x_service_token)
    names = [result.agent for result in req.agents]
    if set(names) != set(AGENTS) or len(names) != len(AGENTS):
        raise HTTPException(422, "exactly one result for each review agent is required")
    return merge_results(req.text, req.agents, req.calibration, req.timing)


@app.get("/sample")
def sample():
    return {"big": SAMPLE_BIG, "content": SAMPLE_CONTENT, "samples": SAMPLES, "guideline_text": SAMPLE_GUIDELINE_TEXT}


@app.post("/review")
async def review_all(req: ReviewRequest, x_service_token: str | None = Header(default=None)):
    """Full multi-agent review. BIG is passed by the gateway (later loaded from DB by brand_id/version)."""
    _auth(x_service_token)
    big = req.big or SAMPLE_BIG
    return await run_review(req.text, big, calibration=req.calibration)


@app.post("/stream/review")
async def review_stream(req: ReviewRequest, x_service_token: str | None = Header(default=None)):
    """Same review, streamed as NDJSON: one `agent` event as each agent finishes, then a final `done` event."""
    _auth(x_service_token)
    big = req.big or SAMPLE_BIG
    queue: asyncio.Queue = asyncio.Queue()

    async def on_done(r):
        await queue.put({"event": "agent", "result": r.model_dump()})

    async def work():
        try:
            await queue.put({"event": "done", "result": await run_review(req.text, big, on_agent_done=on_done, calibration=req.calibration)})
        except Exception as e:  # noqa: BLE001
            await queue.put({"event": "error", "error": str(e)[:200]})
        await queue.put(None)

    async def gen():
        task = asyncio.create_task(work())
        while (item := await queue.get()) is not None:
            yield json.dumps(item) + "\n"
        await task

    return StreamingResponse(gen(), media_type="application/x-ndjson")


class ExtractRequest(BaseModel):
    filename: str
    content_base64: str | None = None
    use_sample: bool = False
    brand_id: str = "brand"


@app.post("/extract")
def extract(req: ExtractRequest, x_service_token: str | None = Header(default=None)):
    """Guideline file (or the sample) -> structured BIG draft + notes for the manager's preview screen."""
    _auth(x_service_token)
    try:
        if req.use_sample:
            text = SAMPLE_GUIDELINE_TEXT
        else:
            data = base64.b64decode(req.content_base64 or "", validate=True)
            if len(data) > 5_000_000:
                raise HTTPException(413, "file too large (5 MB max)")
            text = read_text(req.filename, data)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception:  # noqa: BLE001 - corrupt PDF/DOCX etc.
        raise HTTPException(422, "could not read that file")
    if not text.strip():
        raise HTTPException(422, "no text found in that file (scanned PDFs are not supported yet)")
    big, notes = extract_big(text, brand_id=req.brand_id)
    return {"big": big, "notes": notes, "chars": len(text)}
