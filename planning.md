# Kiosk-Scholar Hackathon Build Context

You are acting as a senior engineer helping build a hackathon project called **Kiosk-Scholar**.

## 🎯 Project Goal
Build a local-first AI-powered PDF understanding system that works offline and allows users to:
- upload PDFs
- extract and process text
- generate summaries
- interact with selected text
- link summaries back to source pages

Core philosophy:
- local-first (Ollama)
- fast execution
- minimal complexity
- demo-ready reliability

---

## 🧠 Core Feature (HIGHEST PRIORITY)

PDF → Summary → Click → Jump to Source Page → Highlight

This must work cleanly. All other features are secondary.

---

## ⚙️ Tech Stack

Frontend:
- Tauri
- pdf.js

Backend:
- Python (FastAPI)

AI:
- Ollama (local LLM)

---

## 🚀 Development Phases

### Phase 1: Setup Dependencies
Goal:
- Initialize Tauri app
- Setup pdf.js
- Setup Python FastAPI backend
- Ensure Ollama is running locally

Deliverables:
- Project runs without errors
- Basic frontend-backend communication possible

---

### Phase 2: PDF Upload & Data Extraction

Goal:
- Upload and render PDF using pdf.js
- Extract text from each page

Expected Output Format:

    [
      { "page": 1, "content": "..." },
      { "page": 2, "content": "..." }
    ]

Validation:
- Text is readable
- Page mapping is correct

---

### Phase 3: AI Integration

Goal:
- Integrate Ollama with backend

Implement:
- summarization
- explain selected text

Implement simple RAG:
- chunk text
- retrieve relevant chunks

IMPORTANT:
- Keep it lightweight (no heavy DB)
- Focus on working output, not perfection

---

### Phase 4: Verification & Debugging

Goal:
- Ensure:
  - summary generates correctly
  - each summary point maps to a page
  - clicking summary navigates to correct page

Fix:
- text extraction issues
- incorrect mappings
- UI glitches

PRIORITY:
- stability > features

---

### Phase 5: Optional Features (ONLY if time permits)

- Flashcards
- Question generation
- Chat mode
- OCR fallback

---

## ⚠️ Constraints

- Hackathon time limit (24 hrs)
- Avoid over-engineering
- Avoid unnecessary dependencies
- Do NOT introduce complexity unless required

---

## 🧭 Instructions for Claude

When helping:
1. Prioritize the CURRENT phase
2. Provide clean, minimal, working code
3. Avoid unnecessary abstractions
4. Always assume this is a hackathon (speed > perfection)
5. If something is complex, suggest a simpler workaround
6. Clearly explain what to implement NEXT

---

## 🧪 Current Phase

Phase X: <replace this before sending>

---

## ❓ Task

Help implement the current phase step-by-step.

- Break into small actionable steps
- Provide code where needed
- Ensure everything is testable

Do NOT jump ahead to future phases.
Focus only on what is needed now.