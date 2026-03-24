const BACKEND_URL = "http://127.0.0.1:8000";

// ── Backend & Ollama health check ──
async function checkBackend() {
  const statusEl = document.getElementById("backend-status");
  const ollamaEl = document.getElementById("ollama-status");
  const ollamaLabel = document.getElementById("ollama-label");
  const ollamaModelLabel = document.getElementById("ollama-model-label");

  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    const data = await res.json();

    statusEl.textContent = "Backend OK";
    statusEl.className = "pill pill-ok";

    if (data.ollama && data.models && data.models.length > 0) {
      const model = data.active_model || data.models[0];
      ollamaEl.className = "ollama-badge ok";
      if (ollamaLabel) ollamaLabel.textContent = "Ollama · online";
      if (ollamaModelLabel) ollamaModelLabel.textContent = `Ollama · ${model}`;
    } else if (data.ollama) {
      ollamaEl.className = "ollama-badge error";
      if (ollamaLabel) ollamaLabel.textContent = "Ollama · no models";
      if (ollamaModelLabel) ollamaModelLabel.textContent = "Ollama · no models";
    } else {
      ollamaEl.className = "ollama-badge error";
      if (ollamaLabel) ollamaLabel.textContent = "Ollama · offline";
      if (ollamaModelLabel) ollamaModelLabel.textContent = "Ollama · offline";
    }
  } catch (err) {
    console.error("Health check failed:", err);
    statusEl.textContent = "Backend unreachable";
    statusEl.className = "pill pill-error";
    if (ollamaEl) ollamaEl.className = "ollama-badge error";
    if (ollamaLabel) ollamaLabel.textContent = "Ollama · unknown";
    if (ollamaModelLabel) ollamaModelLabel.textContent = "Ollama · unknown";
  }
}

// ── View switching ──
function showView(viewId) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const target = document.getElementById(viewId);
  if (target) target.classList.add("active");

  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.classList.toggle(
      "active",
      item.dataset.view === (viewId === "view-upload" ? "upload" : "reader")
    );
  });
}

// ── PDF Upload ──
async function uploadPDF(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BACKEND_URL}/upload-pdf`, { method: "POST", body: formData });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

// ── Summarize ──
async function requestSummary() {
  const res = await fetch(`${BACKEND_URL}/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Summarization failed");
  }
  return res.json();
}

// ── Explain ──
async function requestExplain(text) {
  const res = await fetch(`${BACKEND_URL}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Explanation failed");
  }
  return res.json();
}

// ── PDF Viewer ──
function renderPDFViewer(file) {
  const viewer = document.getElementById("pdf-viewer");
  const objectURL = URL.createObjectURL(file);
  viewer.innerHTML = `<embed src="${objectURL}" type="application/pdf" />`;
}

// ── Sources / Extracted text ──
function renderExtractedText(data) {
  const sidebar = document.getElementById("text-sidebar");
  sidebar.innerHTML = "";

  if (!data.pages || data.pages.length === 0) {
    sidebar.innerHTML = "<p class='empty-state'>No text found in this PDF.</p>";
    return;
  }

  data.pages.forEach((p) => {
    const block = document.createElement("div");
    block.className = "page-block";
    block.dataset.page = p.page;

    const label = document.createElement("div");
    label.className = "page-label";
    label.textContent = `Page ${p.page}`;

    const text = document.createElement("pre");
    text.className = "page-text";
    text.textContent = p.content || "(no text on this page)";

    block.appendChild(label);
    block.appendChild(text);
    sidebar.appendChild(block);
  });
}

// ── AI Summary cards ──
const CARD_LABELS = ["CORE POINT", "KEY INSIGHT", "ANALYSIS", "FINDING", "CONTEXTUAL ANALYSIS"];

function renderSummary(summaryData) {
  const panel = document.getElementById("summary-panel");
  panel.innerHTML = "";

  if (!summaryData || summaryData.length === 0) {
    panel.innerHTML = "<p class='empty-state'>No summary generated.</p>";
    return;
  }

  summaryData.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "summary-card";

    const typeLabel = document.createElement("span");
    typeLabel.className = "card-type-label";
    typeLabel.textContent = CARD_LABELS[idx % CARD_LABELS.length];

    const body = document.createElement("div");
    body.className = "card-body";
    body.textContent = item.point;

    const link = document.createElement("button");
    link.className = "card-link-to-source";
    link.innerHTML = `← Link to Source <span style="color:var(--text-faint);font-weight:400;margin-left:4px;">Page ${item.page}</span>`;
    link.addEventListener("click", () => jumpToPage(item.page));

    card.appendChild(typeLabel);
    card.appendChild(body);
    card.appendChild(link);
    panel.appendChild(card);
  });
}

// ── Jump to source page ──
function jumpToPage(pageNum) {
  activateAiTab("ai-sources-tab");
  const sidebar = document.getElementById("text-sidebar");
  const block = sidebar.querySelector(`.page-block[data-page="${pageNum}"]`);
  if (block) {
    block.scrollIntoView({ behavior: "smooth", block: "start" });
    block.classList.add("highlight");
    setTimeout(() => block.classList.remove("highlight"), 2200);
  }
}

// ── AI Panel tab switching ──
function activateAiTab(tabId) {
  document.querySelectorAll(".ai-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".ai-tab-content").forEach((tc) => {
    tc.classList.toggle("active", tc.id === tabId);
  });
}

// ── Loading helpers ──
function showLoading(el, msg) {
  el.innerHTML = `<p class='empty-state'>⏳ ${msg}</p>`;
}

// ── Floating text-selection "Explain" button (Copilot-style) ──
let _pendingExplainText = "";

function initSelectionExplain() {
  const floatBtn = document.getElementById("selection-explain-btn");
  if (!floatBtn) return;

  document.addEventListener("mouseup", (e) => {
    if (floatBtn.contains(e.target)) return; // clicking the button itself

    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";

    if (text.length < 4) {
      floatBtn.classList.add("hidden");
      _pendingExplainText = "";
      return;
    }

    _pendingExplainText = text;

    // Position just above the selection end
    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const x = Math.min(rect.right, window.innerWidth - 130);
      const y = Math.max(rect.top - 38, 8);
      floatBtn.style.left = `${x}px`;
      floatBtn.style.top = `${y}px`;
    } catch {
      floatBtn.style.left = `${e.clientX}px`;
      floatBtn.style.top = `${Math.max(e.clientY - 42, 8)}px`;
    }

    floatBtn.classList.remove("hidden");
  });

  // Hide on mousedown outside the button
  document.addEventListener("mousedown", (e) => {
    if (!floatBtn.contains(e.target)) {
      floatBtn.classList.add("hidden");
    }
  });

  floatBtn.addEventListener("click", async () => {
    const text = _pendingExplainText;
    if (!text) return;

    floatBtn.classList.add("hidden");
    window.getSelection()?.removeAllRanges();

    // Switch to reader view → Chat tab → show explanation
    showView("view-reader");
    activateAiTab("ai-explain-tab");

    const output = document.getElementById("explain-output");
    const textarea = document.getElementById("explain-input");
    const explainBtn = document.getElementById("explain-btn");

    textarea.value = text;
    showLoading(output, "Explaining selection…");
    explainBtn.disabled = true;

    try {
      const data = await requestExplain(text);
      output.innerHTML = `<div class="explain-result">${escapeHTML(data.explanation)}</div>`;
    } catch (err) {
      output.innerHTML = `<p class="empty-state error">❌ ${err.message}</p>`;
    } finally {
      explainBtn.disabled = false;
    }
  });
}

// ── Sidebar & AI panel collapse toggles ──
function initCollapseToggles() {
  // Left nav toggle
  const navToggle = document.getElementById("nav-toggle-btn");
  navToggle?.addEventListener("click", () => {
    document.body.classList.toggle("nav-collapsed");
    navToggle.title = document.body.classList.contains("nav-collapsed")
      ? "Expand sidebar"
      : "Collapse sidebar";
  });

  // AI panel: close button inside the panel
  const aiCloseBtn = document.getElementById("ai-panel-close-btn");
  aiCloseBtn?.addEventListener("click", () => {
    document.body.classList.add("ai-collapsed");
  });

  // AI panel: re-open via "⊡ AI" button in reader topbar
  const aiToggleBtn = document.getElementById("ai-toggle-btn");
  aiToggleBtn?.addEventListener("click", () => {
    document.body.classList.toggle("ai-collapsed");
    const collapsed = document.body.classList.contains("ai-collapsed");
    aiToggleBtn.textContent = collapsed ? "⊞ AI" : "⊡ AI";
    aiToggleBtn.title = collapsed ? "Show AI panel" : "Hide AI panel";
  });
}

// ── Main ──
window.addEventListener("DOMContentLoaded", () => {
  checkBackend();
  initSelectionExplain();
  initCollapseToggles();

  const importBtn  = document.getElementById("import-pdf-btn");
  const uploadBtn  = document.getElementById("upload-btn");
  const pdfInput   = document.getElementById("pdf-input");
  const uploadArea = document.getElementById("upload-area");
  const explainBtn = document.getElementById("explain-btn");
  const backBtn    = document.getElementById("back-to-upload-btn");

  // AI panel tab switching
  document.querySelectorAll(".ai-tab").forEach((btn) => {
    btn.addEventListener("click", () => activateAiTab(btn.dataset.tab));
  });

  // Nav view switching
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.addEventListener("click", () => {
      showView(item.dataset.view === "upload" ? "view-upload" : "view-reader");
    });
  });

  // File pickers
  importBtn.addEventListener("click", () => pdfInput.click());
  uploadBtn.addEventListener("click", (e) => { e.stopPropagation(); pdfInput.click(); });

  pdfInput.addEventListener("change", () => {
    if (pdfInput.files[0]) handleFile(pdfInput.files[0]);
  });

  // Drag and drop
  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("drag-over");
  });
  uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type === "application/pdf") handleFile(file);
  });

  // Back to upload
  backBtn.addEventListener("click", () => showView("view-upload"));

  // Manual explain (Chat tab)
  explainBtn.addEventListener("click", async () => {
    const input  = document.getElementById("explain-input");
    const output = document.getElementById("explain-output");
    const text   = input.value.trim();

    if (!text) {
      output.innerHTML = "<p class='empty-state error'>Please type a question or select text.</p>";
      return;
    }

    showLoading(output, "Generating explanation…");
    explainBtn.disabled = true;
    explainBtn.textContent = "⏳ Working…";

    try {
      const data = await requestExplain(text);
      output.innerHTML = `<div class="explain-result">${escapeHTML(data.explanation)}</div>`;
    } catch (err) {
      output.innerHTML = `<p class="empty-state error">❌ ${err.message}</p>`;
    } finally {
      explainBtn.disabled = false;
      explainBtn.textContent = "Explain";
    }
  });

  // ── File handler: upload → extract → auto-summarize ──
  async function handleFile(file) {
    showView("view-reader");
    document.getElementById("reader-doc-name").textContent = file.name;
    document.getElementById("reader-page-info").classList.add("hidden");

    renderPDFViewer(file);
    showLoading(document.getElementById("summary-panel"), "Uploading & extracting text…");
    showLoading(document.getElementById("text-sidebar"), "Extracting text…");

    try {
      const data = await uploadPDF(file);

      const pageInfo = document.getElementById("reader-page-info");
      pageInfo.textContent = `${data.total_pages} page${data.total_pages !== 1 ? "s" : ""}`;
      pageInfo.classList.remove("hidden");

      renderExtractedText(data);

      // Auto-summarize — no button click required
      showLoading(document.getElementById("summary-panel"), "Generating AI summary…");
      try {
        const summaryData = await requestSummary();
        renderSummary(summaryData.summary);
        // Switch to Summary tab to show the result
        activateAiTab("ai-summary-tab");
      } catch (err) {
        document.getElementById("summary-panel").innerHTML =
          `<p class="empty-state error">❌ Summary failed: ${err.message}</p>`;
      }
    } catch (err) {
      document.getElementById("text-sidebar").innerHTML =
        `<p class="empty-state error">❌ ${err.message}</p>`;
      document.getElementById("summary-panel").innerHTML =
        `<p class="empty-state error">❌ Upload failed: ${err.message}</p>`;
    }
  }
});

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML.replace(/\n/g, "<br>");
}
