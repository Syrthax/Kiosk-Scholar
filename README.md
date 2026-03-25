# Kiosk-Scholar

> **Local-first AI PDF understanding — fully offline, no cloud, no subscriptions.**

Kiosk-Scholar is a native desktop app that lets you upload any PDF, get an AI-generated structured summary with source-page links, explain selected passages, and listen to your document read aloud — all without an internet connection. Powered by [Ollama](https://ollama.com), [FastAPI](https://fastapi.tiangolo.com), and [Tauri](https://tauri.app).

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![Tauri](https://img.shields.io/badge/Tauri-v2-orange)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📄 **PDF Upload & Rendering** | Drag-and-drop or file-picker upload; renders pages via pdf.js with canvas + text layer |
| 🧠 **AI Summarization** | Ollama (llama3.2) generates a structured bullet-point summary, each point linked to its source page |
| 🔗 **Click-to-Jump** | Click any summary point → instantly jump to that page in the PDF viewer with a highlight animation |
| 💡 **AI Explain** | Select or paste any text; RAG-powered context injection gives you a concise, document-aware explanation |
| 📊 **AI Insights** | Chart.js visualizations of document structure and content distribution |
| 🔊 **Text-to-Speech** | Offline narration using macOS `say` or Windows SAPI — volume control, stop/start, non-blocking |
| 📁 **Recent PDFs** | IndexedDB cache stores previously opened files for instant re-open |
| 🌐 **Landing Page** | macOS-dock-style launcher page served alongside the app |
| 📦 **Bundled & Installable** | Ships as a `.dmg` (macOS) installer with the Python backend embedded |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Desktop App                    │
│  ┌────────────────┐        ┌───────────────────────┐   │
│  │  Vite + pdf.js │◄──────►│  FastAPI (port 8000)  │   │
│  │  Chart.js UI   │  HTTP  │  PyMuPDF text extract │   │
│  │  (port 1420)   │        │  Ollama AI integration│   │
│  └────────────────┘        │  System TTS engine    │   │
│                             └──────────┬────────────┘   │
└──────────────────────────────────────┼─────────────────┘
                                        ▼
                              ┌─────────────────┐
                              │  Ollama (local) │
                              │  llama3.2:latest│
                              │  port 11434     │
                              └─────────────────┘
```

- The Tauri shell manages both the Vite dev server and the embedded Python backend process.
- All AI inference runs locally via Ollama — nothing leaves your machine.
- Simple keyword-overlap RAG (no embeddings or vector DB) keeps the stack lightweight.

---

## 🧰 Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Tauri v2](https://tauri.app) (Rust) |
| Frontend | [Vite](https://vitejs.dev), vanilla JS, [pdf.js](https://mozilla.github.io/pdf.js/), [Chart.js](https://www.chartjs.org) |
| Backend | [FastAPI](https://fastapi.tiangolo.com) + [Uvicorn](https://www.uvicorn.org) (Python 3.10+) |
| PDF processing | [PyMuPDF (fitz)](https://pymupdf.readthedocs.io) |
| AI / LLM | [Ollama](https://ollama.com) — `llama3.2:latest` (3.2B, Q4_K_M, 2 GB) |
| HTTP client | [httpx](https://www.python-httpx.org) |
| TTS | macOS `say` · Windows SAPI via `win32com` |

---

## 🔌 API Endpoints

### `GET /health`
Returns backend and Ollama status.
```json
{
  "status": "ok",
  "ollama": true,
  "models": ["llama3.2:latest"],
  "active_model": "llama3.2:latest"
}
```

### `POST /upload-pdf`
Accepts a PDF file, extracts text per page using PyMuPDF, stores pages in memory.
```json
[
  { "page": 1, "content": "Introduction to..." },
  { "page": 2, "content": "..." }
]
```

### `POST /summarize`
Generates a structured AI summary of the last uploaded PDF.
```json
{
  "summary": [
    { "point": "Students must form teams of up to 4 members.", "page": 2 }
  ]
}
```
- Caps total context at 8 000 characters (800 chars/page)
- Prompts Ollama to return strict JSON array `[{point, page}]`
- Falls back to plain text if JSON parsing fails

### `POST /explain`
Explains selected text using document context via RAG.
```json
// Request
{ "text": "the passage or concept to explain" }

// Response
{ "explanation": "This refers to..." }
```
- Chunks all pages into 1 500-character blocks
- Scores chunks by keyword overlap (top-5 retrieved)
- Injects context into Ollama prompt for a grounded answer

### `POST /tts/speak` · `POST /tts/stop`
Trigger or stop offline text-to-speech narration.

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+**
- **Node.js 18+** and **npm**
- **Rust + Cargo** — [install via rustup](https://rustup.rs)
- **Ollama** — [install from ollama.com](https://ollama.com) then pull the model:
  ```bash
  ollama pull llama3.2
  ollama serve          # keep this running
  ```

---

### 1 — Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### 2 — Frontend (Tauri + Vite)

```bash
cd frontend
npm install
npm run tauri dev
```

Tauri automatically starts the Vite dev server (`npm run dev` on port 1420) before launching the Rust app.

---

### Install from DMG (macOS)

A pre-built installer is available at:

```
frontend/src-tauri/target/release/bundle/dmg/Kiosk-Scholar_0.1.0_aarch64.dmg
```

> **Note:** The app is unsigned. On macOS, right-click → **Open** on first launch to bypass Gatekeeper.

The DMG bundles:
- The Tauri/Rust shell
- The compiled Vite frontend
- A self-contained Python backend with all dependencies in `backend/packages/`

---

## 📁 Project Structure

```
Kiosk-Scholar/
├── backend/
│   ├── main.py              # FastAPI app — PDF upload, summarize, explain, TTS, health
│   ├── tts.py               # Offline TTS engine (macOS say / Windows SAPI)
│   ├── requirements.txt
│   └── packages/            # Vendored Python dependencies (bundled into DMG)
├── frontend/
│   ├── src/
│   │   ├── index.html       # 3-column layout: PDF viewer | AI Summary | Explain/Text
│   │   ├── main.js          # All frontend logic — PDF rendering, AI calls, TTS, charts
│   │   └── styles.css
│   ├── src-tauri/
│   │   ├── src/             # Rust backend — sidecar process management
│   │   └── tauri.conf.json  # Tauri v2 config — window, CSP, bundle targets
│   └── vite.config.js
├── landing/                 # Landing page (macOS dock UI)
└── src-tauri/               # Root-level Tauri config (legacy)
```

---

## 🧠 How the AI Works

1. **Upload** — PyMuPDF extracts text from every page.
2. **Summarize** — Backend truncates content to ~8 000 chars, sends a system-prompted request to Ollama asking for a JSON array of `{point, page}` pairs. The UI renders each point as a card with a clickable page-jump button.
3. **Explain (RAG)** — The selected text is used as a query. All pages are chunked (1 500 chars), each chunk is scored by keyword overlap with the query, and the top-5 chunks are injected as context before asking Ollama to explain the passage.
4. **Source linking** — Clicking a summary card scrolls the extracted-text panel to the matching page and flashes a red highlight for 2 seconds.

---

## ⚠️ Known Limitations

- **In-memory only:** `last_pdf_pages` resets on backend restart — only the most recently uploaded PDF is active.
- **Keyword RAG:** No embeddings or vector DB. Sufficient for the current use case; upgrade to `chromadb` or `faiss` for production.
- **No streaming:** Ollama responses are buffered — a spinner shows during generation (up to ~120s on first load).
- **Unsigned app:** macOS will warn about an unverified developer on first open.
- **Single-user:** No multi-session or persistence layer.

---

## 📝 License

MIT — see [LICENSE](LICENSE).
