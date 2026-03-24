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
      ollamaLabel.textContent = "Ollama · online";
      ollamaModelLabel.textContent = `Ollama · ${model}`;
    } else if (data.ollama) {
      ollamaEl.className = "ollama-badge error";
      ollamaLabel.textContent = "Ollama · no models";
      ollamaModelLabel.textContent = "Ollama · no models";
    } else {
      ollamaEl.className = "ollama-badge error";
      ollamaLabel.textContent = "Ollama · offline";
      ollamaModelLabel.textContent = "Ollama · offline";
    }
  } catch (err) {
    console.error("Health check failed:", err);
    statusEl.textContent = "Backend unreachable";
    statusEl.className = "pill pill-error";
    ollamaEl.className = "ollama-badge error";
    ollamaLabel.textContent = "Ollama · unknown";
    ollamaModelLabel.textContent = "Ollama · unknown";
  }
}

// ── View switching ──
function showView(viewId) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const target = document.getElementById(viewId);
  if (target) target.classList.add("active");

  // Sync active state in nav
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === (viewId === "view-upload" ? "upload" : "reader"));
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

// ── PDF Viewer (embed) ──
function renderPDFViewer(file) {
  const viewer = document.getElementById("pdf-viewer");
  const objectURL = URL.createObjectURL(file);
  viewer.innerHTML = `<embed src="${objectURL}" type="application/pdf" width="100%" height="100%" />`;
}

// ── Extracted text (Sources tab) ──
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
function renderSummary(summaryData) {
  const panel = document.getElementById("summary-panel");
  panel.innerHTML = "";

  if (!summaryData || summaryData.length === 0) {
    panel.innerHTML = "<p class='empty-state'>No summary generated.</p>";
    return;
  }

  const labels = ["CORE POINT", "KEY INSIGHT", "ANALYSIS", "FINDING", "CONTEXTUAL ANALYSIS"];

  summaryData.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "summary-card";

    const typeLabel = document.createElement("span");
    typeLabel.className = "card-type-label";
    typeLabel.textContent = labels[idx % labels.length];

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = item.point.length > 60
      ? item.point.slice(0, 57) + "…"
      : item.point;

    const body = document.createElement("div");
    body.className = "card-body";
    body.textContent = item.point;

    const link = document.createElement("button");
    link.className = "card-link-to-source";
    link.innerHTML = `← Link to Source &nbsp;<span style="color:var(--text-faint);font-weight:400;">Page ${item.page}</span>`;
    link.addEventListener("click", () => jumpToPage(item.page));

    card.appendChild(typeLabel);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(link);
    panel.appendChild(card);
  });
}

// ── Jump to page in Sources tab ──
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

// ── Main ──
window.addEventListener("DOMContentLoaded", () => {
  checkBackend();

  const importBtn  = document.getElementById("import-pdf-btn");
  const uploadBtn  = document.getElementById("upload-btn");
  const pdfInput   = document.getElementById("pdf-input");
  const uploadArea = document.getElementById("upload-area");
  const summarizeBtn = document.getElementById("summarize-btn");
  const explainBtn   = document.getElementById("explain-btn");
  const backBtn      = document.getElementById("back-to-upload-btn");

  // AI Panel tab switching
  document.querySelectorAll(".ai-tab").forEach((btn) => {
    btn.addEventListener("click", () => activateAiTab(btn.dataset.tab));
  });

  // Nav item view switching
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.addEventListener("click", () => {
      const viewId = item.dataset.view === "upload" ? "view-upload" : "view-reader";
      showView(viewId);
    });
  });

  // Both "Import PDF" buttons open the file picker
  importBtn.addEventListener("click", () => pdfInput.click());
  uploadBtn.addEventListener("click", (e) => { e.stopPropagation(); pdfInput.click(); });

  pdfInput.addEventListener("change", () => {
    if (pdfInput.files[0]) handleFile(pdfInput.files[0]);
  });

  // Upload card drag-and-drop
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

  // Back button → return to upload view
  backBtn.addEventListener("click", () => showView("view-upload"));

  // Summarize
  summarizeBtn.addEventListener("click", async () => {
    const panel = document.getElementById("summary-panel");
    showLoading(panel, "Generating AI summary… this may take a minute.");
    summarizeBtn.disabled = true;
    summarizeBtn.textContent = "⏳ Working…";

    try {
      const data = await requestSummary();
      renderSummary(data.summary);
      // Auto-switch to Summary tab
      activateAiTab("ai-summary-tab");
    } catch (err) {
      panel.innerHTML = `<p class="empty-state error">❌ ${err.message}</p>`;
    } finally {
      summarizeBtn.disabled = false;
      summarizeBtn.textContent = "🤖 Summarize";
    }
  });

  // Explain / Chat
  explainBtn.addEventListener("click", async () => {
    const input  = document.getElementById("explain-input");
    const output = document.getElementById("explain-output");
    const text   = input.value.trim();
    if (!text) {
      output.innerHTML = "<p class='empty-state error'>Please enter a question or text to explain.</p>";
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

  async function handleFile(file) {
    // Switch to reader view and update header
    showView("view-reader");
    document.getElementById("reader-doc-name").textContent = file.name;
    document.getElementById("reader-page-info").classList.add("hidden");

    // Render PDF immediately
    renderPDFViewer(file);

    // Reset panels
    showLoading(document.getElementById("summary-panel"), "Uploading & extracting text…");
    showLoading(document.getElementById("text-sidebar"), "Extracting text…");

    try {
      const data = await uploadPDF(file);
      const pageInfo = document.getElementById("reader-page-info");
      pageInfo.textContent = `${data.total_pages} page${data.total_pages !== 1 ? "s" : ""}`;
      pageInfo.classList.remove("hidden");

      renderExtractedText(data);
      summarizeBtn.disabled = false;

      // Show "ready" state in summary panel
      document.getElementById("summary-panel").innerHTML =
        "<p class='empty-state'>Text extracted. Click <strong>Summarize</strong> to generate AI insights.</p>";
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
