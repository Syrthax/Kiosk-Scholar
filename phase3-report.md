# Phase 3 Report — AI Integration

**Project:** Kiosk-Scholar  
**Phase:** 3 — AI Integration (Ollama + RAG)  
**Date Completed:** March 24, 2026  
**Branch:** `main` → [github.com/Syrthax/Kiosk-Scholar](https://github.com/Syrthax/Kiosk-Scholar)  
**Commits:**
- `df1341d` — Phase 3: AI Integration - Ollama summarization, explain, and simple RAG
- `2cde37f` — Phase 3: Ollama live integration - auto-detect model, show active model in UI
- `cbc2af4` — Fix: Add Vite dev server for proper HTTP origin, remove CSP blocking fetch

---

## ✅ Goals Completed

| Goal | Status |
|------|--------|
| Integrate Ollama with FastAPI backend | ✅ Done |
| Summarization endpoint (`/summarize`) | ✅ Done |
| Explain selected text endpoint (`/explain`) | ✅ Done |
| Simple RAG (chunk + keyword retrieval) | ✅ Done |
| Summary points linked to source pages | ✅ Done |
| Click summary → jump + highlight source page | ✅ Done |
| Frontend AI Summary panel | ✅ Done |
| Frontend Explain tab | ✅ Done |
| Ollama model status in header | ✅ Done |
| Fix Tauri → backend fetch (Vite dev server) | ✅ Fixed |

---

## 🧠 AI Stack

| Component | Detail |
|-----------|--------|
| **LLM** | Ollama — local, offline |
| **Model** | `llama3.2:latest` (3.2B parameters, Q4_K_M quantization) |
| **Model Size** | 2.0 GB |
| **Ollama API** | `http://127.0.0.1:11434` |
| **Model auto-detection** | Falls back to first available model if `llama3.2` not found |
| **Summarization prompt** | System-prompted to return strict JSON array of `{point, page}` |
| **Explain prompt** | Context-injected from RAG retrieval + user-selected text |
| **RAG type** | Keyword-overlap scoring (no embeddings, no vector DB) |
| **Chunk size** | 1500 characters per chunk |
| **Top-K retrieval** | 5 most relevant chunks injected into explain prompt |
| **Context window limit** | 8000 characters max sent to Ollama for summarization |
| **Request timeout** | 120 seconds (LLM generation) / 5 seconds (health check) |

---

## 🔌 Backend API — New Endpoints

### `GET /health`
Returns backend + Ollama status.

**Response:**
```json
{
  "status": "ok",
  "message": "Kiosk-Scholar backend is running",
  "ollama": true,
  "models": ["llama3.2:latest"],
  "active_model": "llama3.2:latest"
}
```

---

### `POST /summarize`
Generates a structured AI summary of the last uploaded PDF.

**Request body:** `{}` (uses last uploaded PDF stored in memory)

**Response:**
```json
{
  "summary": [
    { "point": "The document describes a short-term Python project...", "page": 1 },
    { "point": "Students must form teams of up to 4 members.", "page": 2 }
  ]
}
```

**Internals:**
- Takes up to 800 chars per page, caps total at 8000 chars
- Sends to Ollama with a strict JSON-output system prompt
- Regex-extracts JSON array from response
- Falls back to plain text if JSON parse fails

---

### `POST /explain`
Explains selected text using document context via RAG.

**Request body:**
```json
{ "text": "the selected or typed text to explain" }
```

**Response:**
```json
{ "explanation": "This refers to..." }
```

**Internals:**
- Chunks all stored pages into 1500-char blocks
- Scores chunks by keyword overlap with the query text
- Top 5 chunks injected as context into Ollama prompt
- Returns plain text explanation

---

### `POST /upload-pdf` *(updated)*
Now also stores extracted pages globally in `last_pdf_pages` for AI endpoints to use.

---

## 🖥️ Frontend Changes

### Layout — 3 Columns
```
[ PDF Viewer (flex:1) ] | [ AI Summary (340px) ] | [ Text / Explain tabs (340px) ]
```

### New UI Elements

| Element | Description |
|---------|-------------|
| `🤖 Summarize` button | In PDF info bar, enabled after upload |
| AI Summary panel | Middle column, shows summary cards |
| `📄 Page X` link buttons | On each summary card — click to jump |
| Page highlight animation | Red flash on target page block for 2s |
| Tab bar | "Extracted Text" / "Explain" toggle |
| Explain textarea | User pastes/types text to explain |
| `💡 Explain` button | Triggers `/explain` API call |
| Ollama status badge | Header shows `✅ Ollama: llama3.2:latest` |

### Key JS Functions

| Function | Purpose |
|----------|---------|
| `checkBackend()` | Polls `/health` on load, updates both status badges |
| `requestSummary()` | POSTs to `/summarize`, returns summary array |
| `requestExplain(text)` | POSTs to `/explain`, returns explanation string |
| `renderSummary(data)` | Builds summary cards with page-link buttons |
| `jumpToPage(pageNum)` | Switches to text tab, scrolls to + highlights page block |
| `activateTab(tabId)` | Toggles tab visibility |
| `escapeHTML(str)` | Sanitizes Ollama response before rendering as HTML |

---

## 🐛 Critical Bug Fixed — Tauri ↔ Backend Communication

### Root Cause
Tauri v2 serves its webview via the `https://tauri.localhost` custom protocol. Any `fetch()` call from this origin to `http://127.0.0.1:8000` was blocked as **mixed content** (HTTPS → HTTP) — even with CSP allowing `connect-src http://127.0.0.1:8000`.

### Fix Applied
Introduced **Vite** as a proper HTTP dev server (`http://localhost:1420`). Tauri now loads the app from this URL via `devUrl`, making it a true HTTP origin that can freely call the HTTP backend.

**Files changed:**

| File | Change |
|------|--------|
| `frontend/vite.config.js` | New — Vite config, serves `src/`, port 1420 |
| `frontend/package.json` | Added `"dev": "vite"` and `"build": "vite build"` scripts |
| `frontend/src-tauri/tauri.conf.json` | Added `devUrl`, `beforeDevCommand`, `beforeBuildCommand`; removed CSP |

---

## 📁 Files Changed in Phase 3

```
backend/
  main.py               ← +150 lines: /summarize, /explain, RAG helpers,
                            Ollama integration, get_model(), updated /health
  requirements.txt      ← Added: httpx

frontend/
  src/index.html        ← 3-column layout, summary panel, explain tab, tab bar
  src/main.js           ← All AI frontend logic (~220 new lines)
  src/styles.css        ← Styles for summary cards, tabs, explain tab (~130 new lines)
  src-tauri/
    tauri.conf.json     ← devUrl, beforeDevCommand, CSP removed
  vite.config.js        ← New file
  package.json          ← Added dev/build scripts + vite devDependency
  package-lock.json     ← Updated

.gitignore              ← Cleaned up redundant entries
```

---

## 🚀 How to Run

### Prerequisites
- Python 3.10+
- Node.js 18+
- Rust + Cargo
- [Ollama](https://ollama.com) installed and running (`ollama serve`)
- Model pulled: `ollama pull llama3.2`

### Start Backend
```powershell
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Start Frontend (Tauri + Vite)
```powershell
cd frontend
npm install
npm run tauri dev
```

> Tauri will automatically start Vite (`npm run dev`) before launching the Rust app.

---

## 🧪 Verified Working (from Backend Logs)

```
GET  /health       → 200 OK  ✅
POST /upload-pdf   → 200 OK  ✅
POST /summarize    → 200 OK  ✅  (Ollama generating summaries)
POST /explain      → 200 OK  ✅  (Ollama explaining text via RAG)
```

---

## 📌 Known Limitations / Notes

- **In-memory storage:** `last_pdf_pages` is reset on backend restart. Only the most recently uploaded PDF is available for AI.
- **RAG is keyword-based:** No embeddings or vector DB. Good enough for hackathon; upgrade to `chromadb` or `faiss` for production.
- **JSON parsing:** If Ollama returns malformed JSON for summarization, the app falls back to showing raw text as a single summary point.
- **Ollama timeout:** Set to 120s. First run after model load may be slow (~10–30s for 3.2B).
- **No streaming:** Ollama responses are not streamed — the UI shows a spinner until completion.

---

## 🔜 Next — Phase 4

- Verify summary-to-page mapping accuracy
- Fix any incorrect page number assignments
- Test with multiple PDF types (academic papers, reports, books)
- Ensure explain tab works with copy-pasted text from the PDF viewer
- UI polish and stability pass
