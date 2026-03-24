from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz  # PyMuPDF
import httpx
import json
import re
import math
from collections import Counter

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


@app.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    global last_pdf_pages

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    contents = await file.read()
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

    return {"filename": file.filename, "total_pages": len(pages), "pages": pages}


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

    # Fallback: split into bullet lines
    if summary is None:
        lines = [l.strip('-•* \t') for l in cleaned.split('\n') if l.strip('-•* \t')]
        summary = [{"point": l, "page": 1} for l in lines[:12]] if lines else [{"point": cleaned[:500], "page": 1}]

    return {"summary": summary}


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


# ── Common English stop-words to filter out of keyword counts ──
_STOPWORDS = {
    "the","a","an","and","or","but","in","on","at","to","for","of","with",
    "by","from","is","are","was","were","be","been","being","have","has",
    "had","do","does","did","will","would","could","should","may","might",
    "shall","can","that","this","these","those","it","its","they","them",
    "their","there","then","than","so","as","if","not","no","nor","yet",
    "both","either","neither","each","few","more","most","other","some",
    "such","into","through","during","before","after","above","below",
    "between","out","off","over","under","again","further","once","which",
    "who","whom","what","when","where","why","how","all","any","about",
    "also","just","he","she","we","you","i","his","her","our","your","my",
    "up","down","get","got","make","made","take","taken","use","used",
    "also","while","within","without","among","along","upon","whether",
}


@app.get("/insights")
async def insights():
    """Return structured analytics for the last uploaded PDF."""
    if not last_pdf_pages:
        raise HTTPException(status_code=400, detail="No PDF uploaded yet")

    # ── Per-page word counts ──
    page_word_counts = []
    all_words: list[str] = []

    for p in last_pdf_pages:
        raw_words = re.findall(r"[a-zA-Z']+", p["content"].lower())
        filtered = [w for w in raw_words if len(w) > 2 and w not in _STOPWORDS]
        page_word_counts.append({"page": p["page"], "words": len(raw_words), "content_words": len(filtered)})
        all_words.extend(filtered)

    # ── Top 10 global keywords ──
    top_keywords = [{"word": w, "count": c} for w, c in Counter(all_words).most_common(10)]

    # ── Reading-time estimate (avg 238 wpm) ──
    total_words = sum(p["words"] for p in page_word_counts)
    reading_time_min = round(total_words / 238, 1)

    # ── Top keywords per page (for heatmap-style bar chart) ──
    page_top_word = []
    for p in last_pdf_pages:
        raw_words = re.findall(r"[a-zA-Z']+", p["content"].lower())
        filtered = [w for w in raw_words if len(w) > 2 and w not in _STOPWORDS]
        if filtered:
            top = Counter(filtered).most_common(1)[0]
            page_top_word.append({"page": p["page"], "word": top[0], "count": top[1]})
        else:
            page_top_word.append({"page": p["page"], "word": "", "count": 0})

    # ── Lexical diversity per page (unique / total content words) ──
    lexical_diversity = []
    for p in last_pdf_pages:
        raw_words = re.findall(r"[a-zA-Z']+", p["content"].lower())
        filtered = [w for w in raw_words if len(w) > 2 and w not in _STOPWORDS]
        diversity = round(len(set(filtered)) / len(filtered), 3) if filtered else 0
        lexical_diversity.append({"page": p["page"], "diversity": diversity})

    return {
        "total_pages": len(last_pdf_pages),
        "total_words": total_words,
        "reading_time_min": reading_time_min,
        "page_word_counts": page_word_counts,
        "top_keywords": top_keywords,
        "page_top_word": page_top_word,
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

