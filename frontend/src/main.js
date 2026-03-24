const BACKEND_URL = "http://127.0.0.1:8000";

// ── Backend & Ollama health check ──
async function checkBackend() {
  const statusEl = document.getElementById("backend-status");
  const ollamaEl = document.getElementById("ollama-status");
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    const data = await res.json();
    statusEl.textContent = `✅ Backend OK`;
    statusEl.className = "backend-status ok";

    if (data.ollama) {
      ollamaEl.textContent = "✅ Ollama OK";
      ollamaEl.className = "backend-status ok";
    } else {
      ollamaEl.textContent = "⚠️ Ollama offline";
      ollamaEl.className = "backend-status error";
    }
  } catch {
    statusEl.textContent = "❌ Backend unreachable";
    statusEl.className = "backend-status error";
    ollamaEl.textContent = "❌ Ollama unknown";
    ollamaEl.className = "backend-status error";
  }
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

// ── Extracted text sidebar ──
function renderExtractedText(data) {
  const sidebar = document.getElementById("text-sidebar");
  sidebar.innerHTML = "";

  if (!data.pages || data.pages.length === 0) {
    sidebar.innerHTML = "<p class='sidebar-placeholder'>No text found in this PDF.</p>";
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

// ── Summary panel rendering ──
function renderSummary(summaryData) {
  const panel = document.getElementById("summary-panel");
  panel.innerHTML = "";

  if (!summaryData || summaryData.length === 0) {
    panel.innerHTML = "<p class='sidebar-placeholder'>No summary generated.</p>";
    return;
  }

  summaryData.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "summary-card";

    const bullet = document.createElement("div");
    bullet.className = "summary-bullet";
    bullet.textContent = item.point;

    const pageLink = document.createElement("button");
    pageLink.className = "summary-page-link";
    pageLink.textContent = `📄 Page ${item.page}`;
    pageLink.addEventListener("click", () => jumpToPage(item.page));

    card.appendChild(bullet);
    card.appendChild(pageLink);
    panel.appendChild(card);
  });
}

// ── Jump to page in extracted text sidebar ──
function jumpToPage(pageNum) {
  // Switch to text tab
  activateTab("text-tab");

  const sidebar = document.getElementById("text-sidebar");
  const block = sidebar.querySelector(`.page-block[data-page="${pageNum}"]`);
  if (block) {
    block.scrollIntoView({ behavior: "smooth", block: "start" });
    block.classList.add("highlight");
    setTimeout(() => block.classList.remove("highlight"), 2000);
  }
}

// ── Tabs ──
function activateTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-content").forEach((tc) => {
    tc.classList.toggle("active", tc.id === tabId);
  });
}

// ── Loading helpers ──
function showLoading(el, msg) {
  el.innerHTML = `<p class='sidebar-placeholder'>⏳ ${msg}</p>`;
}

// ── Main ──
window.addEventListener("DOMContentLoaded", () => {
  checkBackend();

  const uploadBtn = document.getElementById("upload-btn");
  const pdfInput = document.getElementById("pdf-input");
  const uploadArea = document.getElementById("upload-area");
  const summarizeBtn = document.getElementById("summarize-btn");
  const explainBtn = document.getElementById("explain-btn");

  // Tab switching
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  uploadBtn.addEventListener("click", () => pdfInput.click());

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

  // Summarize button
  summarizeBtn.addEventListener("click", async () => {
    const panel = document.getElementById("summary-panel");
    showLoading(panel, "Generating AI summary… this may take a minute.");
    summarizeBtn.disabled = true;
    summarizeBtn.textContent = "⏳ Working…";

    try {
      const data = await requestSummary();
      renderSummary(data.summary);
    } catch (err) {
      panel.innerHTML = `<p class="sidebar-placeholder error">❌ ${err.message}</p>`;
    } finally {
      summarizeBtn.disabled = false;
      summarizeBtn.textContent = "🤖 Summarize";
    }
  });

  // Explain button
  explainBtn.addEventListener("click", async () => {
    const input = document.getElementById("explain-input");
    const output = document.getElementById("explain-output");
    const text = input.value.trim();
    if (!text) {
      output.innerHTML = "<p class='sidebar-placeholder error'>Please enter some text to explain.</p>";
      return;
    }

    showLoading(output, "Generating explanation…");
    explainBtn.disabled = true;
    explainBtn.textContent = "⏳ Working…";

    try {
      const data = await requestExplain(text);
      output.innerHTML = `<div class="explain-result">${escapeHTML(data.explanation)}</div>`;
    } catch (err) {
      output.innerHTML = `<p class="sidebar-placeholder error">❌ ${err.message}</p>`;
    } finally {
      explainBtn.disabled = false;
      explainBtn.textContent = "💡 Explain";
    }
  });

  async function handleFile(file) {
    // Show filename + render PDF
    document.getElementById("pdf-info").classList.remove("hidden");
    document.getElementById("pdf-name").textContent = file.name;
    renderPDFViewer(file);

    // Reset panels
    document.getElementById("summary-panel").innerHTML =
      "<p class='sidebar-placeholder'>⏳ Uploading & extracting text…</p>";

    showLoading(document.getElementById("text-sidebar"), "Extracting text…");

    try {
      const data = await uploadPDF(file);
      document.getElementById("pdf-pages").textContent = `${data.total_pages} pages`;
      renderExtractedText(data);
      summarizeBtn.disabled = false;
    } catch (err) {
      document.getElementById("text-sidebar").innerHTML =
        `<p class="sidebar-placeholder error">❌ ${err.message}</p>`;
      document.getElementById("summary-panel").innerHTML =
        `<p class="sidebar-placeholder error">❌ Upload failed</p>`;
    }
  }
});

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML.replace(/\n/g, "<br>");
}
