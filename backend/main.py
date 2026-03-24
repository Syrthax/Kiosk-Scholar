from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz  # PyMuPDF
import httpx
import json
import re

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
