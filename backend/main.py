from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import fitz  # PyMuPDF
import httpx
import json
import re

# Import TTS module for voice narration
from tts import get_tts_engine, TTSState

app = FastAPI(title="Kiosk-Scholar API")

OLLAMA_URL = "http://127.0.0.1:11434"
MODEL = "llama3.2:latest"  # preferred model; auto-detects fallback

# Allow Tauri frontend (local origin) to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory store for the last uploaded PDF pages ──
last_pdf_pages: list[dict] = []


# ── Helper: get active model (auto-detect if preferred isn't available) ──
async def get_model() -> str:
    """Return the best available model name."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            models = [m["name"] for m in r.json().get("models", [])]
            if MODEL in models:
                return MODEL
            # Fallback: first available model
            if models:
                return models[0]
    except Exception:
        pass
    return MODEL  # optimistic fallback


# ── Helper: call Ollama ──
async def ollama_generate(prompt: str, system: str = "") -> str:
    """Send a prompt to Ollama and return the response text."""
    active_model = await get_model()
    payload = {
        "model": active_model,
        "prompt": prompt,
        "stream": False,
    }
    if system:
        payload["system"] = system

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/generate", json=payload)
        resp.raise_for_status()
        return resp.json().get("response", "")


# ── Helper: simple chunking for RAG ──
def chunk_pages(pages: list[dict], max_chars: int = 1500) -> list[dict]:
    """Split page contents into smaller chunks, preserving page references."""
    chunks = []
    for p in pages:
        text = p["content"]
        if not text:
            continue
        # Split into sentences roughly
        for i in range(0, len(text), max_chars):
            chunk_text = text[i : i + max_chars]
            chunks.append({"page": p["page"], "text": chunk_text})
    return chunks


def retrieve_relevant(chunks: list[dict], query: str, top_k: int = 5) -> list[dict]:
    """Very simple keyword-overlap retrieval (no embeddings needed)."""
    query_words = set(query.lower().split())
    scored = []
    for c in chunks:
        words = set(c["text"].lower().split())
        overlap = len(query_words & words)
        scored.append((overlap, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [s[1] for s in scored[:top_k]]


# ── Routes ──

@app.get("/health")
async def health():
    ollama_ok = False
    models = []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            if r.status_code == 200:
                ollama_ok = True
                models = [m["name"] for m in r.json().get("models", [])]
    except Exception:
        pass
    return {
        "status": "ok",
        "message": "Kiosk-Scholar backend is running",
        "ollama": ollama_ok,
        "models": models,
        "active_model": models[0] if models else None,
    }


class UploadPDFRequest(BaseModel):
    filename: str
    data: str  # base64-encoded PDF bytes


@app.post("/upload-pdf")
async def upload_pdf(req: UploadPDFRequest):
    global last_pdf_pages

    if not req.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    try:
        contents = base64.b64decode(req.data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 payload: {e}")

    try:
        doc = fitz.open(stream=contents, filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse PDF: {e}")

    pages = []
    for i, page in enumerate(doc):
        text = page.get_text().strip()
        pages.append({"page": i + 1, "content": text})

    doc.close()

    # Store for later AI queries
    last_pdf_pages = pages

    return {"filename": req.filename, "total_pages": len(pages), "pages": pages}


class SummarizeRequest(BaseModel):
    pages: list[dict] | None = None  # optional override; otherwise uses last uploaded


@app.post("/summarize")
async def summarize(req: SummarizeRequest = SummarizeRequest()):
    pages = req.pages if req.pages else last_pdf_pages
    if not pages:
        raise HTTPException(status_code=400, detail="No PDF uploaded yet")

    # Build a condensed input (limit to ~8000 chars to stay within context)
    combined = ""
    for p in pages:
        snippet = p["content"][:800]
        if snippet:
            combined += f"\n--- Page {p['page']} ---\n{snippet}\n"
    combined = combined[:8000]

    system = (
        "You are a study assistant. Summarize the following document. "
        "Return a JSON array of objects with keys: \"point\" (a concise summary bullet) "
        "and \"page\" (the source page number as an integer). "
        "Return ONLY valid JSON, no markdown, no extra text."
    )
    prompt = f"Document content:\n{combined}\n\nProvide a JSON summary array:"

    try:
        raw = await ollama_generate(prompt, system)
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Ollama is not running. Start it with: ollama serve")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ollama error: {e}")

    # Strip markdown code fences that models often add
    cleaned = re.sub(r'```(?:json)?\s*', '', raw, flags=re.IGNORECASE).strip().rstrip('`').strip()
    # Remove trailing commas before ] or } (LLMs often emit invalid JSON like [{...},])
    cleaned = re.sub(r',\s*([\]}])', r'\1', cleaned)

    def extract_json_array(text):
        """Find the first balanced JSON array in text (handles nested brackets)."""
        start = text.find('[')
        if start == -1:
            return None
        depth, in_str, esc = 0, False, False
        for i, ch in enumerate(text[start:], start):
            if esc:
                esc = False
                continue
            if ch == '\\' and in_str:
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
        return None

    summary = None

    # Try 1: direct parse of cleaned response
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            summary = parsed
    except json.JSONDecodeError:
        pass

    # Try 2: extract balanced JSON array from within the text
    if summary is None:
        array_str = extract_json_array(cleaned)
        if array_str:
            try:
                parsed = json.loads(array_str)
                if isinstance(parsed, list):
                    summary = parsed
            except json.JSONDecodeError:
                pass

    # Fallback: try parsing individual lines as JSON objects
    if summary is None:
        items = []
        for line in cleaned.split('\n'):
            line = line.strip().strip(',').strip()
            if not line or line in ('[', ']'):
                continue
            try:
                obj = json.loads(line)
                if isinstance(obj, dict):
                    items.append(obj)
                    continue
            except Exception:
                pass
            # plain text line — wrap it
            clean_line = line.strip('-•* \t')
            if clean_line:
                items.append({"point": clean_line, "page": 1})
        if items:
            summary = items
        else:
            summary = [{"point": cleaned[:500], "page": 1}]

    # ── Normalise every item so it is always {"point": str, "page": int} ──
    # The LLM sometimes returns an array of JSON-encoded strings like
    # '{"point": "...", "page": 1}' instead of actual objects.
    normalised = []
    for item in summary:
        if isinstance(item, str):
            # Try to parse the string as a JSON object
            item_stripped = item.strip()
            try:
                parsed_item = json.loads(item_stripped)
                if isinstance(parsed_item, dict):
                    item = parsed_item
                else:
                    item = {"point": item_stripped, "page": 1}
            except (json.JSONDecodeError, ValueError):
                item = {"point": item_stripped, "page": 1}

        if isinstance(item, dict):
            point = str(item.get("point") or item.get("summary") or item.get("text") or "").strip()
            try:
                page = int(item.get("page") or item.get("page_number") or 1)
            except (TypeError, ValueError):
                page = 1
            if point:
                normalised.append({"point": point, "page": page})

    if not normalised:
        normalised = [{"point": "Could not parse summary.", "page": 1}]

    return {"summary": normalised}


class ExplainRequest(BaseModel):
    text: str
    context_pages: list[int] | None = None  # optional page numbers for context


@app.post("/explain")
async def explain(req: ExplainRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="No text provided")

    # Use RAG: find relevant chunks
    chunks = chunk_pages(last_pdf_pages)
    relevant = retrieve_relevant(chunks, req.text)
    context = "\n".join(
        f"[Page {c['page']}]: {c['text'][:500]}" for c in relevant
    )

    system = (
        "You are a helpful study assistant. Explain the selected text in simple terms. "
        "Use the provided document context to give an accurate explanation."
    )
    prompt = (
        f"Document context:\n{context}\n\n"
        f"Selected text to explain:\n\"{req.text}\"\n\n"
        f"Provide a clear, concise explanation:"
    )

    try:
        raw = await ollama_generate(prompt, system)
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Ollama is not running. Start it with: ollama serve")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ollama error: {e}")

    return {"explanation": raw.strip()}


# ── /insights — document analytics (no LLM required) ──
STOP_WORDS = {
    "the","a","an","and","or","but","in","on","at","to","for","of","with",
    "by","from","as","is","was","are","were","be","been","being","have","has",
    "had","do","does","did","will","would","could","should","may","might",
    "shall","can","this","that","these","those","it","its","i","you","he",
    "she","we","they","me","him","her","us","them","my","your","his","our",
    "their","what","which","who","not","no","so","if","then","than","also",
    "into","over","after","before","about","up","out","more","all","any",
}


@app.get("/insights")
async def insights():
    if not last_pdf_pages:
        raise HTTPException(status_code=400, detail="No PDF uploaded yet")

    total_words = 0
    page_word_counts = []
    word_freq: dict[str, int] = {}
    lexical_diversity = []

    for p in last_pdf_pages:
        raw = p["content"] or ""
        tokens = re.findall(r"[a-zA-Z']+", raw.lower())
        total = len(tokens)
        content_tokens = [t for t in tokens if t not in STOP_WORDS and len(t) > 2]
        content_count = len(content_tokens)
        unique_tokens = set(tokens)
        diversity = round(len(unique_tokens) / total, 3) if total > 0 else 0.0

        page_word_counts.append({
            "page": p["page"],
            "words": total,
            "content_words": content_count,
        })
        lexical_diversity.append({"page": p["page"], "diversity": diversity})
        total_words += total

        for w in content_tokens:
            word_freq[w] = word_freq.get(w, 0) + 1

    top_keywords = sorted(
        [{"word": w, "count": c} for w, c in word_freq.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:15]

    reading_time_min = max(1, round(total_words / 200))

    return {
        "total_pages": len(last_pdf_pages),
        "total_words": total_words,
        "reading_time_min": reading_time_min,
        "page_word_counts": page_word_counts,
        "top_keywords": top_keywords,
        "lexical_diversity": lexical_diversity,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Text-to-Speech (TTS) Endpoints
# ══════════════════════════════════════════════════════════════════════════════

class TTSRequest(BaseModel):
    text: str


class TTSVolumeRequest(BaseModel):
    volume: float  # 0.0 to 1.0


class TTSRateRequest(BaseModel):
    rate: int  # words per minute (80-200 recommended)


@app.post("/tts/speak")
async def tts_speak(req: TTSRequest):
    """
    Start speaking the provided text.
    
    This is non-blocking - returns immediately while speech happens in background.
    If already speaking, stops current speech and starts new.
    """
    text = req.text.strip() if req.text else ""
    
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")
    
    engine = get_tts_engine()
    
    try:
        success = engine.speak(text)
        if success:
            return {"status": "speaking", "message": "Speech started"}
        else:
            raise HTTPException(status_code=500, detail="Failed to start speech")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS error: {str(e)}")


@app.post("/tts/stop")
async def tts_stop():
    """
    Stop current speech immediately.
    """
    engine = get_tts_engine()
    engine.stop()
    return {"status": "stopped", "message": "Speech stopped"}


@app.get("/tts/status")
async def tts_status():
    """
    Get current TTS status.
    """
    engine = get_tts_engine()
    return {
        "state": engine.state.value,
        "is_speaking": engine.is_speaking,
        "volume": engine.volume,
        "rate": engine.rate,
    }


@app.post("/tts/volume")
async def tts_set_volume(req: TTSVolumeRequest):
    """
    Set TTS volume (0.0 to 1.0).
    
    Takes effect immediately, even during speech.
    """
    volume = max(0.0, min(1.0, req.volume))
    engine = get_tts_engine()
    engine.volume = volume
    return {"status": "ok", "volume": engine.volume}


@app.post("/tts/rate")
async def tts_set_rate(req: TTSRateRequest):
    """
    Set TTS speech rate (words per minute).
    
    Takes effect on next speak() call.
    Recommended range: 80-200 wpm.
    """
    rate = max(50, min(300, req.rate))
    engine = get_tts_engine()
    engine.rate = rate
    return {"status": "ok", "rate": engine.rate}


@app.post("/tts/speak-page")
async def tts_speak_page(page_number: int = 1):
    """
    Speak the content of a specific page from the last uploaded PDF.
    
    Args:
        page_number: Page number (1-indexed)
    """
    if not last_pdf_pages:
        raise HTTPException(status_code=400, detail="No PDF uploaded yet")
    
    if page_number < 1 or page_number > len(last_pdf_pages):
        raise HTTPException(
            status_code=400, 
            detail=f"Page {page_number} not found. PDF has {len(last_pdf_pages)} pages."
        )
    
    page_content = last_pdf_pages[page_number - 1]["content"]
    
    if not page_content.strip():
        raise HTTPException(
            status_code=400, 
            detail=f"Page {page_number} has no text content"
        )
    
    engine = get_tts_engine()
    
    try:
        success = engine.speak(page_content)
        if success:
            return {
                "status": "speaking",
                "page": page_number,
                "message": f"Speaking page {page_number}"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to start speech")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS error: {str(e)}")


# ══════════════════════════════════════════════════════════════════════════════
# Ollama Setup & System-Spec Endpoints  (onboarding / settings)
# Purely additive — no existing code modified.  Only stdlib + already-imported
# modules (re, httpx, asyncio, json) are used.
# ══════════════════════════════════════════════════════════════════════════════

import asyncio as _asyncio
import platform as _platform
import subprocess as _subprocess
import uuid as _uuid

_TIER_MODELS: dict[str, list[str]] = {
    "low":  ["phi3:mini", "tinyllama"],
    "mid":  ["llama3:8b", "mistral:7b"],
    "high": ["llama3:8b", "mixtral"],
}

# Validate model names — prevent shell/command injection
_SAFE_MODEL_RE = re.compile(r'^[a-zA-Z0-9._:/@-]+$')

# Active pull jobs:  { job_id -> status_dict }
_pull_jobs: dict[str, dict] = {}


def _get_ram_gb() -> float:
    """Return total system RAM in GB using only stdlib."""
    try:
        sysname = _platform.system()
        if sysname == "Darwin":
            r = _subprocess.run(["sysctl", "-n", "hw.memsize"],
                                capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                return round(int(r.stdout.strip()) / (1024 ** 3), 1)
        elif sysname == "Linux":
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        return round(int(line.split()[1]) / (1024 ** 2), 1)
        elif sysname == "Windows":
            r = _subprocess.run(
                ["wmic", "computersystem", "get", "TotalPhysicalMemory"],
                capture_output=True, text=True, timeout=5)
            nums = [ln.strip() for ln in r.stdout.splitlines() if ln.strip().isdigit()]
            if nums:
                return round(int(nums[0]) / (1024 ** 3), 1)
    except Exception:
        pass
    return 8.0  # safe fallback


def _ram_to_tier(ram_gb: float) -> tuple[str, list[str]]:
    if ram_gb <= 8:
        return "low", _TIER_MODELS["low"]
    elif ram_gb <= 16:
        return "mid", _TIER_MODELS["mid"]
    return "high", _TIER_MODELS["high"]


@app.get("/ollama/status")
async def ollama_status():
    """Is Ollama installed / running? Which models are available?"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            if r.status_code == 200:
                models = [m["name"] for m in r.json().get("models", [])]
                return {"installed": True, "running": True, "models": models}
    except Exception:
        pass

    # API unreachable — check if the binary is present
    try:
        cmd = ["where", "ollama"] if _platform.system() == "Windows" else ["which", "ollama"]
        proc = _subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        binary_found = proc.returncode == 0
    except Exception:
        binary_found = False

    return {"installed": binary_found, "running": False, "models": []}


@app.get("/system/specs")
async def system_specs():
    """Detect RAM and return tier + recommended models."""
    ram_gb = _get_ram_gb()
    tier, recommended = _ram_to_tier(ram_gb)
    return {"ram_gb": ram_gb, "tier": tier, "recommended_models": recommended}


class _PullModelRequest(BaseModel):
    model: str


@app.post("/ollama/pull")
async def pull_model(req: _PullModelRequest):
    """Start an async model pull. Returns a job_id to poll for progress."""
    model = req.model.strip()
    if not model or not _SAFE_MODEL_RE.match(model):
        raise HTTPException(status_code=400, detail="Invalid model name")

    job_id = str(_uuid.uuid4())[:8]
    _pull_jobs[job_id] = {
        "model": model, "status": "starting",
        "progress": 0, "message": "Starting…",
        "error": None, "done": False,
    }
    _asyncio.create_task(_do_pull(job_id, model))
    return {"job_id": job_id, "model": model}


@app.get("/ollama/pull/{job_id}/status")
async def pull_job_status(job_id: str):
    """Poll the progress of a model pull."""
    if job_id not in _pull_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return _pull_jobs[job_id]


async def _do_pull(job_id: str, model: str) -> None:
    job = _pull_jobs[job_id]
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST", f"{OLLAMA_URL}/api/pull",
                json={"name": model, "stream": True},
            ) as resp:
                if resp.status_code != 200:
                    job.update({"status": "error",
                                "error": f"Ollama HTTP {resp.status_code}", "done": True})
                    return
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except Exception:
                        continue
                    status_str = data.get("status", "")
                    job["message"] = status_str
                    total = data.get("total", 0)
                    if total:
                        job["progress"] = round(data.get("completed", 0) / total * 100)
                    if status_str == "success":
                        job.update({"status": "done", "progress": 100,
                                    "message": "Installed", "done": True})
                        return
                    if data.get("error"):
                        job.update({"status": "error",
                                    "error": data["error"], "done": True})
                        return
                    job["status"] = "pulling"
        job.update({"status": "done", "progress": 100, "message": "Installed", "done": True})
    except Exception as exc:
        job.update({"status": "error", "error": str(exc), "done": True})

