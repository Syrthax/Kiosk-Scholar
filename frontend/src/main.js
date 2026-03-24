import * as pdfjsLib from 'pdfjs-dist';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

// ?url tells Vite to register this file as a static asset and return its
// correct served URL.  The previous `new URL('pdfjs-dist/...', import.meta.url)`
// approach only works for *relative* paths — Vite does not transform bare-module
// specifiers in new URL(), so the runtime URL pointed to a non-existent path on
// the dev server and pdf.js silently fell through to its broken fake-worker path.
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const BACKEND_URL = "http://127.0.0.1:8000";

// ── PDF Cache (IndexedDB — stores files so Recents can reopen them) ──
let _reopenPDF = null; // set inside DOMContentLoaded once handleFile is defined

function _openPdfDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ks-pdf-cache', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('pdfs');
    req.onsuccess = e => resolve(e.target.result);
    req.onerror  = e => reject(e.target.error);
  });
}

async function storePdfInCache(name, arrayBuffer) {
  try {
    const db = await _openPdfDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('pdfs', 'readwrite');
      tx.objectStore('pdfs').put(arrayBuffer, name);
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  } catch { /* best-effort — ignore failures */ }
}

async function getPdfFromCache(name) {
  try {
    const db = await _openPdfDB();
    return await new Promise((resolve, reject) => {
      const tx  = db.transaction('pdfs', 'readonly');
      const req = tx.objectStore('pdfs').get(name);
      req.onsuccess = e => resolve(e.target.result || null);
      req.onerror   = e => reject(e.target.error);
    });
  } catch { return null; }
}

// ── Backend & Ollama health check (self-scheduling) ──
let _backendPollTimer = null;

async function checkBackend() {
  clearTimeout(_backendPollTimer);
  const statusEl = document.getElementById("backend-status");
  const ollamaEl = document.getElementById("ollama-status");
  const ollamaLabel = document.getElementById("ollama-label");
  const ollamaModelLabel = document.getElementById("ollama-model-label");

  let online = false;
  try {
    const res = await fetch(`${BACKEND_URL}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json();

    statusEl.textContent = "Backend OK";
    statusEl.className = "pill pill-ok";
    online = true;

    if (data.ollama && data.models && data.models.length > 0) {
      const model = data.active_model || data.models[0];
      ollamaEl.className = "ollama-badge ok";
      if (ollamaLabel) ollamaLabel.textContent = "Ollama · online";
      if (ollamaModelLabel) ollamaModelLabel.textContent = `Ollama · ${model}`;
      syncOnboardingUI(true, data.models);
    } else if (data.ollama) {
      ollamaEl.className = "ollama-badge error";
      if (ollamaLabel) ollamaLabel.textContent = "Ollama · no models";
      if (ollamaModelLabel) ollamaModelLabel.textContent = "Ollama · no models";
      syncOnboardingUI(true, []);
    } else {
      ollamaEl.className = "ollama-badge error";
      if (ollamaLabel) ollamaLabel.textContent = "Ollama · offline";
      if (ollamaModelLabel) ollamaModelLabel.textContent = "Ollama · offline";
      syncOnboardingUI(false, []);
    }
  } catch (err) {
    console.error("Health check failed:", err.message);
    statusEl.textContent = "Backend unreachable";
    statusEl.className = "pill pill-error";
    if (ollamaEl) ollamaEl.className = "ollama-badge error";
    if (ollamaLabel) ollamaLabel.textContent = "Ollama · unknown";
    if (ollamaModelLabel) ollamaModelLabel.textContent = "Ollama · unknown";
  }

  // Retry fast (3s) while offline; slow heartbeat (30s) once connected
  _backendPollTimer = setTimeout(checkBackend, online ? 30_000 : 3_000);
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

// ── PDF Upload (base64 JSON — avoids WKWebView binary FormData corruption) ──
async function uploadPDF(arrayBuffer, filename) {
  // Encode binary PDF bytes as base64 so WKWebView can't mangle them
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  const data = btoa(binary);

  const res = await fetch(`${BACKEND_URL}/upload-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, data }),
  });
  if (!res.ok) {
    const err = await res.json();
    const detail = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
    throw new Error(detail || "Upload failed");
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

// ── PDF Viewer (pdf.js canvas + textLayer) ──
let _pdfDoc = null;

// Accepts a pre-read ArrayBuffer (NOT a File) to avoid double-consuming the blob
async function renderPDFViewer(arrayBuffer) {
  const viewer = document.getElementById("pdf-viewer");
  viewer.innerHTML = '<p class="viewer-placeholder">Rendering PDF…</p>';

  // Destroy previous document to free memory
  if (_pdfDoc) {
    await _pdfDoc.destroy();
    _pdfDoc = null;
  }

  // Slice the buffer before handing it to pdf.js.
  // pdf.js transfers the ArrayBuffer to its Web Worker via postMessage, which
  // *detaches* (neuters) the original in the main thread.  If we passed the
  // same reference here that uploadPDF() will use later, uploadPDF would
  // receive a zero-length detached buffer and throw "Buffer is already detached".
  // slice(0) creates a cheap independent copy; pdf.js owns and transfers that
  // copy while the caller's arrayBuffer stays intact for the backend upload.
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
  _pdfDoc = await loadingTask.promise;

  viewer.innerHTML = "";

  for (let pageNum = 1; pageNum <= _pdfDoc.numPages; pageNum++) {
    const page = await _pdfDoc.getPage(pageNum);
    const scale = 1.4;
    const viewport = page.getViewport({ scale });

    // Page wrapper — position:relative is required for textLayer alignment
    const pageWrapper = document.createElement("div");
    pageWrapper.className = "pdf-page-wrapper";
    pageWrapper.dataset.page = pageNum;
    pageWrapper.style.width = `${viewport.width}px`;
    pageWrapper.style.height = `${viewport.height}px`;

    // Canvas layer
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // TextLayer div — must be same size and absolutely over the canvas
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    textLayerDiv.style.width = `${viewport.width}px`;
    textLayerDiv.style.height = `${viewport.height}px`;

    pageWrapper.appendChild(canvas);
    pageWrapper.appendChild(textLayerDiv);
    viewer.appendChild(pageWrapper);

    // Render canvas first
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Render text layer (pdfjs v4+ TextLayer class)
    const textContent = await page.getTextContent();
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport,
    });
    await textLayer.render();
  }
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

    const body = document.createElement("div");
    body.className = "card-body";
    body.textContent = item.point;

    const link = document.createElement("button");
    link.className = "card-link-to-source";
    link.innerHTML = `← Link to Source <span style="color:var(--text-faint);font-weight:400;margin-left:4px;">Page ${item.page}</span>`;
    link.addEventListener("click", () => jumpToPage(item.page));

    card.appendChild(body);
    card.appendChild(link);
    panel.appendChild(card);
  });
}

// ── Jump to source page ──
function jumpToPage(pageNum) {
  // Scroll the PDF canvas viewer to the correct page without switching tabs
  const pdfViewer = document.getElementById("pdf-viewer");
  const pdfPageEl = pdfViewer?.querySelector(`.pdf-page-wrapper[data-page="${pageNum}"]`);
  if (pdfPageEl) {
    pdfPageEl.scrollIntoView({ behavior: "smooth", block: "start" });

    // Briefly flash a highlight ring around the page so the user knows where they landed
    pdfPageEl.style.transition = "box-shadow 0.2s ease";
    pdfPageEl.style.boxShadow = "0 0 0 3px var(--accent), 0 10px 48px rgba(0,0,0,.6)";
    setTimeout(() => {
      pdfPageEl.style.boxShadow = "";
      setTimeout(() => { pdfPageEl.style.transition = ""; }, 300);
    }, 1800);
  }

  // Highlight the matching block in the Sources sidebar (without switching to it)
  const sidebar = document.getElementById("text-sidebar");
  const block = sidebar?.querySelector(`.page-block[data-page="${pageNum}"]`);
  if (block) {
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
  initInsights();
  initNarration();
  initSettings();

  // Onboarding banner buttons
  document.getElementById('onboarding-dismiss-btn')?.addEventListener('click', _hideBanner);
  document.getElementById('onboarding-settings-btn')?.addEventListener('click', () => {
    _hideBanner();
    document.getElementById('settings-modal')?.classList.remove('hidden');
    loadAiSetupPanel();
  });
  const importBtn  = document.getElementById("import-pdf-btn");
  const uploadBtn  = document.getElementById("upload-btn");
  const pdfInput   = document.getElementById("pdf-input");
  const uploadArea = document.getElementById("upload-area");
  const explainBtn = document.getElementById("explain-btn");
  const backBtn    = document.getElementById("back-to-upload-btn");

  // AI panel tab switching
  document.querySelectorAll(".ai-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activateAiTab(btn.dataset.tab);
      if (btn.dataset.tab === "ai-insights-tab") loadInsights();
    });
  });

  // Nav view switching
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.addEventListener("click", () => {
      if (item.dataset.view === "upload") {
        showView("view-upload");
      } else if (item.dataset.view === "recent") {
        showView("view-recent");
        renderRecentView();
      } else {
        showView("view-reader");
      }
    });
  });

  // File pickers
  importBtn.addEventListener("click", (e) => { e.stopPropagation(); pdfInput.click(); });
  uploadBtn.addEventListener("click", (e) => { e.stopPropagation(); pdfInput.click(); });

  pdfInput.addEventListener("change", () => {
    if (pdfInput.files[0]) {
      handleFile(pdfInput.files[0]);
      // Reset so the same file can be re-selected next time
      pdfInput.value = "";
    }
  });

  // Clicking anywhere on the upload card also opens the picker
  uploadArea.addEventListener("click", () => pdfInput.click());

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
    saveRecentPDF(file.name);

    // ── Step 1: Read file bytes ONCE upfront ──
    // This prevents the race condition where renderPDFViewer and uploadPDF
    // both try to consume the same File blob concurrently in Tauri WKWebView.
    let arrayBuffer;
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch (err) {
      document.getElementById("pdf-viewer").innerHTML =
        `<p class="viewer-placeholder">❌ Could not read file: ${err.message}</p>`;
      return;
    }

    // Cache for Recents re-open (fire-and-forget)
    storePdfInCache(file.name, arrayBuffer);

    // ── Step 2: Render PDF client-side FIRST (fully offline, no backend needed) ──
    try {
      await renderPDFViewer(arrayBuffer);
      const pageInfo = document.getElementById("reader-page-info");
      pageInfo.textContent = `${_pdfDoc.numPages} page${_pdfDoc.numPages !== 1 ? "s" : ""}`;
      pageInfo.classList.remove("hidden");
    } catch (err) {
      document.getElementById("pdf-viewer").innerHTML =
        `<p class="viewer-placeholder">❌ Failed to render PDF: ${err.message}</p>`;
      // Don't return — still attempt backend upload for text extraction
    }

    // ── Step 3: Backend upload using the same bytes (create new Blob to avoid re-read) ──
    showLoading(document.getElementById("summary-panel"), "Uploading & extracting text…");
    showLoading(document.getElementById("text-sidebar"), "Extracting text…");

    try {
      // Pass arrayBuffer + filename directly; uploadPDF encodes to base64 JSON
      const data = await uploadPDF(arrayBuffer, file.name);

      renderExtractedText(data);

      // Auto-summarize
      showLoading(document.getElementById("summary-panel"), "Generating AI summary…");
      try {
        const summaryData = await requestSummary();
        renderSummary(summaryData.summary);
        activateAiTab("ai-summary-tab");
      } catch (err) {
        document.getElementById("summary-panel").innerHTML =
          `<p class="empty-state error">❌ Summary failed: ${err.message}</p>`;
      }
    } catch (err) {
      console.error("[upload] error:", err.message);
      document.getElementById("text-sidebar").innerHTML =
        `<p class='empty-state error'>❌ Text extraction failed: ${err.message}</p>`;
      document.getElementById("summary-panel").innerHTML =
        `<p class="empty-state error">❌ Upload error: ${err.message}</p>`;
    }
  }
  _reopenPDF = handleFile; // expose to module scope for Recents
});

// ── Insights ──
const ACCENT   = '#5b4cf5';
const ACCENT2  = '#8b7cf8';
const GREEN    = '#16a34a';
const ORANGE   = '#ea580c';
const TEAL     = '#0891b2';
const PALETTE  = [ACCENT, ACCENT2, TEAL, GREEN, ORANGE, '#db2777', '#65a30d', '#d97706', '#7c3aed', '#0f766e'];

// Track chart instances so we can destroy before re-render
const _chartInstances = {};

function destroyChart(id) {
  if (_chartInstances[id]) {
    _chartInstances[id].destroy();
    delete _chartInstances[id];
  }
}

// ── Build a small "insight card" with a canvas inside ──
function makeInsightCard(id, title) {
  const card = document.createElement('div');
  card.className = 'insight-card';
  card.dataset.chartId = id;
  card.dataset.chartTitle = title;

  const header = document.createElement('div');
  header.className = 'insight-card-header';

  const titleEl = document.createElement('span');
  titleEl.className = 'insight-card-title';
  titleEl.textContent = title;

  const zoomBtn = document.createElement('button');
  zoomBtn.className = 'insight-zoom-btn';
  zoomBtn.title = 'Expand chart';
  zoomBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
    <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
  </svg>`;

  header.appendChild(titleEl);
  header.appendChild(zoomBtn);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'insight-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.id = id;
  canvasWrap.appendChild(canvas);

  card.appendChild(header);
  card.appendChild(canvasWrap);

  // Clicking card or zoom btn opens modal
  [card, zoomBtn].forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    openChartModal(id, title);
  }));

  return { card, canvas };
}

// ── Open chart in modal ──
let _modalChart = null;

function openChartModal(sourceId, title) {
  const sourceChart = _chartInstances[sourceId];
  if (!sourceChart) return;

  const modal = document.getElementById('chart-modal');
  const modalCanvas = document.getElementById('chart-modal-canvas');
  const modalTitle = document.getElementById('chart-modal-title');

  modalTitle.textContent = title;
  modal.classList.remove('hidden');

  // Destroy previous modal chart
  if (_modalChart) { _modalChart.destroy(); _modalChart = null; }

  // Clone config from source chart for the modal canvas
  const srcCfg = sourceChart.config;
  _modalChart = new Chart(modalCanvas, {
    type: srcCfg.type,
    data: JSON.parse(JSON.stringify(srcCfg.data)),
    options: {
      ...JSON.parse(JSON.stringify(srcCfg.options || {})),
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        ...(srcCfg.options?.plugins || {}),
        legend: { ...(srcCfg.options?.plugins?.legend || {}), labels: { font: { size: 13 } } },
      },
    },
  });
}

function closeChartModal() {
  document.getElementById('chart-modal').classList.add('hidden');
  if (_modalChart) { _modalChart.destroy(); _modalChart = null; }
  document.getElementById('chart-modal-canvas').width = document.getElementById('chart-modal-canvas').width; // reset
}

// ── Fetch insights from backend & render ──
async function loadInsights() {
  const panel = document.getElementById('insights-panel');
  panel.innerHTML = `<p class='empty-state'>⏳ Generating insights…</p>`;

  let data;
  try {
    const res = await fetch(`${BACKEND_URL}/insights`);
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
    data = await res.json();
  } catch (err) {
    panel.innerHTML = `<p class='empty-state error'>❌ ${err.message}</p>`;
    return;
  }

  panel.innerHTML = '';

  // ── Stats strip ──
  const stats = document.createElement('div');
  stats.className = 'insight-stats-strip';
  stats.innerHTML = `
    <div class="insight-stat"><span class="insight-stat-val">${data.total_pages}</span><span class="insight-stat-lbl">Pages</span></div>
    <div class="insight-stat"><span class="insight-stat-val">${data.total_words.toLocaleString()}</span><span class="insight-stat-lbl">Words</span></div>
    <div class="insight-stat"><span class="insight-stat-val">${data.reading_time_min} min</span><span class="insight-stat-lbl">Est. Read</span></div>
  `;
  panel.appendChild(stats);

  // ── Chart 1: Words per page (bar) ──
  {
    destroyChart('chart-words');
    const { card, canvas } = makeInsightCard('chart-words', 'Words per Page');
    panel.appendChild(card);
    _chartInstances['chart-words'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.page_word_counts.map(p => `P${p.page}`),
        datasets: [{
          label: 'Words',
          data: data.page_word_counts.map(p => p.words),
          backgroundColor: ACCENT + 'cc',
          borderColor: ACCENT,
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { font: { size: 10 } } },
        },
      },
    });
  }

  // ── Chart 2: Top keywords (horizontal bar) ──
  {
    destroyChart('chart-keywords');
    const { card, canvas } = makeInsightCard('chart-keywords', 'Top Keywords');
    panel.appendChild(card);
    _chartInstances['chart-keywords'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.top_keywords.map(k => k.word),
        datasets: [{
          label: 'Occurrences',
          data: data.top_keywords.map(k => k.count),
          backgroundColor: PALETTE,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { font: { size: 10 } } },
          y: { ticks: { font: { size: 10 } } },
        },
      },
    });
  }

  // ── Chart 3: Lexical diversity per page (line) ──
  {
    destroyChart('chart-diversity');
    const { card, canvas } = makeInsightCard('chart-diversity', 'Lexical Diversity / Page');
    panel.appendChild(card);
    _chartInstances['chart-diversity'] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: data.lexical_diversity.map(p => `P${p.page}`),
        datasets: [{
          label: 'Diversity',
          data: data.lexical_diversity.map(p => p.diversity),
          borderColor: TEAL,
          backgroundColor: TEAL + '22',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: TEAL,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { min: 0, max: 1, ticks: { font: { size: 10 } } },
        },
      },
    });
  }

  // ── Chart 4: Content vs total words doughnut ──
  {
    destroyChart('chart-doughnut');
    const { card, canvas } = makeInsightCard('chart-doughnut', 'Content vs. Stop-Words');
    panel.appendChild(card);
    const totalContent = data.page_word_counts.reduce((s, p) => s + p.content_words, 0);
    const totalStop = data.total_words - totalContent;
    _chartInstances['chart-doughnut'] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Content words', 'Stop-words'],
        datasets: [{
          data: [totalContent, totalStop],
          backgroundColor: [ACCENT + 'dd', '#e5e7eb'],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12 } },
        },
        cutout: '62%',
      },
    });
  }
}

function initInsights() {
  // Close modal on backdrop click or close button
  document.getElementById('chart-modal-backdrop') && document.getElementById('chart-modal-backdrop').addEventListener('click', closeChartModal);
  document.getElementById('chart-modal-close').addEventListener('click', closeChartModal);
  document.querySelector('.chart-modal-backdrop').addEventListener('click', closeChartModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChartModal(); });
}

// ══════════════════════════════════════════════════════════════════════════════
// Narration (Text-to-Speech) Controls
// ══════════════════════════════════════════════════════════════════════════════

let _narrationPolling = null;   // interval handle for status polling
let _narrationActive = false;   // local state mirror

function initNarration() {
  const playBtn   = document.getElementById('narrate-play-btn');
  const stopBtn   = document.getElementById('narrate-stop-btn');
  const volumeWrap = document.getElementById('narrate-volume-wrap');
  const volumeSlider = document.getElementById('narrate-volume');
  const statusEl  = document.getElementById('narrate-status');

  if (!playBtn || !stopBtn) return;

  // ── Play button: speak the currently visible page ──
  playBtn.addEventListener('click', async () => {
    // Debounce rapid clicks
    if (playBtn.disabled) return;
    playBtn.disabled = true;
    setTimeout(() => { playBtn.disabled = false; }, 400);

    const pageText = getVisiblePageText();
    if (!pageText) {
      flashNarrateStatus('No text on this page');
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/tts/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pageText }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'TTS error');
      }
      setNarrationUI(true);
      startNarrationPolling();
    } catch (err) {
      console.error('Narration error:', err);
      flashNarrateStatus('Error starting narration');
    }
  });

  // ── Stop button ──
  stopBtn.addEventListener('click', async () => {
    if (stopBtn.disabled) return;
    stopBtn.disabled = true;
    setTimeout(() => { stopBtn.disabled = false; }, 300);

    try {
      await fetch(`${BACKEND_URL}/tts/stop`, { method: 'POST' });
    } catch (err) {
      console.error('Stop error:', err);
    }
    setNarrationUI(false);
    stopNarrationPolling();
  });

  // ── Volume slider: real-time volume adjustment ──
  volumeSlider.addEventListener('input', async () => {
    const vol = parseInt(volumeSlider.value, 10) / 100;
    try {
      await fetch(`${BACKEND_URL}/tts/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: vol }),
      });
    } catch (err) {
      console.error('Volume adjust error:', err);
    }
  });

  // Set initial volume on backend
  fetch(`${BACKEND_URL}/tts/volume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume: 0.8 }),
  }).catch(() => {});
}

/**
 * Get the extracted text for the page currently most visible in the PDF viewer.
 * Falls back to all visible page text blocks in the Sources sidebar.
 */
function getVisiblePageText() {
  const viewer = document.getElementById('pdf-viewer');
  if (!viewer) return '';

  // Find the page wrapper most visible in the viewport
  const wrappers = viewer.querySelectorAll('.pdf-page-wrapper[data-page]');
  let bestPage = 1;
  let bestVisible = 0;

  wrappers.forEach((w) => {
    const rect = w.getBoundingClientRect();
    const viewerRect = viewer.getBoundingClientRect();
    const top = Math.max(rect.top, viewerRect.top);
    const bot = Math.min(rect.bottom, viewerRect.bottom);
    const visible = Math.max(0, bot - top);
    if (visible > bestVisible) {
      bestVisible = visible;
      bestPage = parseInt(w.dataset.page, 10);
    }
  });

  // Get text from the Sources sidebar (extracted text)
  const pageBlock = document.querySelector(`#text-sidebar .page-block[data-page="${bestPage}"] .page-text`);
  if (pageBlock && pageBlock.textContent.trim()) {
    return pageBlock.textContent.trim();
  }

  return '';
}

/**
 * Update narration UI between playing/idle states
 */
function setNarrationUI(speaking) {
  _narrationActive = speaking;
  const playBtn    = document.getElementById('narrate-play-btn');
  const stopBtn    = document.getElementById('narrate-stop-btn');
  const volumeWrap = document.getElementById('narrate-volume-wrap');
  const statusEl   = document.getElementById('narrate-status');

  if (speaking) {
    playBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    volumeWrap.classList.remove('hidden');
    statusEl.textContent = '● Speaking';
    statusEl.classList.remove('hidden');
    stopBtn.classList.add('narrate-active');
  } else {
    playBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    volumeWrap.classList.add('hidden');
    statusEl.classList.add('hidden');
    stopBtn.classList.remove('narrate-active');
  }
}

/**
 * Show a brief status flash on the narration bar
 */
function flashNarrateStatus(msg) {
  const statusEl = document.getElementById('narrate-status');
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.classList.remove('hidden');
  setTimeout(() => { statusEl.classList.add('hidden'); }, 2500);
}

/**
 * Poll the backend for TTS status so UI stays in sync
 * (e.g., narration finishes naturally → update buttons)
 */
function startNarrationPolling() {
  stopNarrationPolling();
  _narrationPolling = setInterval(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/tts/status`);
      const data = await res.json();
      if (!data.is_speaking && _narrationActive) {
        setNarrationUI(false);
        stopNarrationPolling();
      }
    } catch {
      // Backend unreachable — stop polling
      stopNarrationPolling();
    }
  }, 800);
}

function stopNarrationPolling() {
  if (_narrationPolling) {
    clearInterval(_narrationPolling);
    _narrationPolling = null;
  }
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML.replace(/\n/g, "<br>");
}

// ══════════════════════════════════════════════════════════════════════════════
// Theme management (Light / Dark / Auto)
// ══════════════════════════════════════════════════════════════════════════════

const THEME_KEY = 'ks-theme';

/**
 * Apply the resolved theme to <html data-theme>.
 * @param {'light'|'dark'|'auto'} mode
 */
function applyTheme(mode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = mode === 'dark' || (mode === 'auto' && prefersDark);
  if (useDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/**
 * Persist and apply a theme mode, then update button active states.
 * @param {'light'|'dark'|'auto'} mode
 */
function setTheme(mode) {
  localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
  updateThemeBtns(mode);
}

/** Highlight the correct theme button in the settings modal. */
function updateThemeBtns(mode) {
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeMode === mode);
  });
}

/** Initialise the settings modal and theme logic. */
function initSettings() {
  const openBtn  = document.getElementById('settings-btn');
  const modal    = document.getElementById('settings-modal');
  const closeBtn = document.getElementById('settings-modal-close');
  const backdrop = modal?.querySelector('.settings-modal-backdrop');

  if (!modal) return;

  // Open
  openBtn?.addEventListener('click', () => {
    modal.classList.remove('hidden');
    const current = localStorage.getItem(THEME_KEY) || 'auto';
    updateThemeBtns(current);
    loadAiSetupPanel(); // refresh AI section every time settings opens
  });

  // Close
  const closeModal = () => modal.classList.add('hidden');
  closeBtn?.addEventListener('click', closeModal);
  backdrop?.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });

  // Theme buttons
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTheme(btn.dataset.themeMode));
  });

  // Listen to OS preference changes (for Auto mode)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = localStorage.getItem(THEME_KEY) || 'auto';
    if (current === 'auto') applyTheme('auto');
  });

  // Apply the saved theme on load (the inline script in HTML already does this
  // for the very first paint, but we also need to mark the active button)
  const saved = localStorage.getItem(THEME_KEY) || 'auto';
  applyTheme(saved);
  updateThemeBtns(saved);
}

// ──────────────────────────────────────────────────────────────────────────────
// Onboarding Banner  (new — no existing code changed)
// ──────────────────────────────────────────────────────────────────────────────

function syncOnboardingUI(ollamaRunning, models) {
  const banner = document.getElementById('onboarding-banner');
  const titleEl = document.getElementById('onboarding-title');
  const subEl   = document.getElementById('onboarding-sub');
  if (!banner) return;

  if (!ollamaRunning) {
    titleEl.textContent = 'Ollama not running';
    subEl.textContent   = 'AI features are unavailable. Start Ollama or install it from ollama.com.';
    _showBanner();
  } else if (models.length === 0) {
    titleEl.textContent = 'No AI models installed';
    subEl.textContent   = 'Open Settings → AI Setup to install a model.';
    _showBanner();
  } else {
    _hideBanner();
  }
}

function _showBanner() {
  const b = document.getElementById('onboarding-banner');
  if (!b || !b.classList.contains('hidden')) return;
  b.classList.remove('hidden');
  document.body.classList.add('banner-visible');
}

function _hideBanner() {
  const b = document.getElementById('onboarding-banner');
  if (!b) return;
  b.classList.add('hidden');
  document.body.classList.remove('banner-visible');
}

// ──────────────────────────────────────────────────────────────────────────────
// AI Setup Panel  (Settings modal section)
// ──────────────────────────────────────────────────────────────────────────────

async function loadAiSetupPanel() {
  const panel = document.getElementById('ai-setup-panel');
  if (!panel) return;
  panel.innerHTML = '<p class="ai-setup-loading">Checking…</p>';

  let status, specs;
  try {
    const [sr, sp] = await Promise.all([
      fetch(`${BACKEND_URL}/ollama/status`, { signal: AbortSignal.timeout(5000) })
        .then(r => { if (!r.ok) throw new Error(`/ollama/status ${r.status}`); return r.json(); }),
      fetch(`${BACKEND_URL}/system/specs`,  { signal: AbortSignal.timeout(5000) })
        .then(r => { if (!r.ok) throw new Error(`/system/specs ${r.status}`); return r.json(); }),
    ]);
    status = sr; specs = sp;
  } catch (err) {
    panel.innerHTML = `<p class="ai-setup-error">⚠️ Could not reach backend (${err.message}). Make sure the app backend is running.</p>`;
    return;
  }

  panel.innerHTML = '';

  // — Ollama status row —
  const dotClass   = status.running ? 'ok' : (status.installed ? 'warn' : 'bad');
  const statusText = status.running ? 'Running ✅'
    : (status.installed ? 'Installed, not running' : 'Not installed ❌');

  const statusRow = document.createElement('div');
  statusRow.className = 'ai-status-row';
  statusRow.innerHTML = `
    <span class="ai-status-dot ${escapeHTML(dotClass)}"></span>
    <span class="ai-status-label">Ollama</span>
    <span class="ai-status-value">${escapeHTML(statusText)}</span>`;
  panel.appendChild(statusRow);

  if (!status.installed) {
    const tip = document.createElement('p');
    tip.className = 'ai-setup-tip';
    tip.textContent = 'Download Ollama from ollama.com, install it, then restart the app.';
    panel.appendChild(tip);
    const link = document.createElement('a');
    link.href = 'https://ollama.com';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'btn-primary btn-sm ai-install-link';
    link.textContent = '↗ Download Ollama';
    panel.appendChild(link);
    return;
  }

  if (!status.running) {
    const tip = document.createElement('p');
    tip.className = 'ai-setup-tip';
    tip.textContent = 'Run “ollama serve” in a terminal, then refresh the app.';
    panel.appendChild(tip);
  }

  // — Installed models —
  if (status.models.length > 0) {
    const list = document.createElement('div');
    list.className = 'ai-models-list';
    status.models.forEach(m => {
      const item = document.createElement('div');
      item.className = 'ai-model-item';
      item.innerHTML = `<span class="ai-model-dot"></span><span class="ai-model-name">${escapeHTML(m)}</span>`;
      list.appendChild(item);
    });
    panel.appendChild(list);
  } else {
    const tip = document.createElement('p');
    tip.className = 'ai-setup-tip';
    tip.textContent = 'No models installed yet. Install one below.';
    panel.appendChild(tip);
  }

  if (!status.running) return; // can’t pull without Ollama running

  // — Install new model —
  const installWrap = document.createElement('div');
  installWrap.className = 'ai-install-section';

  const tip2 = document.createElement('p');
  tip2.className = 'ai-setup-tip';
  tip2.textContent = `Recommended for your system (${specs.ram_gb} GB RAM):`;
  installWrap.appendChild(tip2);

  const formRow = document.createElement('div');
  formRow.className = 'ai-install-form';

  const sel = document.createElement('select');
  sel.className = 'ai-model-select';
  sel.setAttribute('aria-label', 'Select model to install');
  specs.recommended_models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    sel.appendChild(opt);
  });

  const installBtn = document.createElement('button');
  installBtn.className = 'btn-primary btn-sm';
  installBtn.textContent = 'Install';

  const progressWrap = document.createElement('div');
  progressWrap.className = 'ai-install-progress hidden';
  progressWrap.innerHTML = `
    <div class="ai-progress-bar-wrap"><div class="ai-progress-bar" id="ai-pb" style="width:0%"></div></div>
    <span class="ai-progress-msg" id="ai-pm">Preparing…</span>`;

  installBtn.addEventListener('click', () => {
    if (sel.value) _installModel(sel.value, installBtn, progressWrap);
  });

  formRow.appendChild(sel);
  formRow.appendChild(installBtn);
  installWrap.appendChild(formRow);
  installWrap.appendChild(progressWrap);
  panel.appendChild(installWrap);
}

async function _installModel(modelName, btn, progressWrap) {
  btn.disabled = true;
  btn.textContent = 'Installing…';
  progressWrap.classList.remove('hidden');
  const bar = progressWrap.querySelector('#ai-pb');
  const msg = progressWrap.querySelector('#ai-pm');

  let jobId;
  try {
    const res = await fetch(`${BACKEND_URL}/ollama/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Pull failed'); }
    jobId = (await res.json()).job_id;
  } catch (err) {
    if (msg) msg.textContent = `❌ ${err.message}`;
    btn.disabled = false; btn.textContent = 'Retry';
    return;
  }

  while (true) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const job = await fetch(`${BACKEND_URL}/ollama/pull/${jobId}/status`).then(r => r.json());
      if (bar) bar.style.width = `${job.progress}%`;
      if (msg) msg.textContent = job.message || 'Downloading…';
      if (job.done) {
        if (job.status === 'done') {
          btn.textContent = '✓ Installed';
          if (msg) msg.textContent = 'Model installed!';
          setTimeout(() => loadAiSetupPanel(), 1200);
        } else {
          if (msg) msg.textContent = `❌ ${job.error || 'Error'}`;
          btn.disabled = false; btn.textContent = 'Retry';
        }
        break;
      }
    } catch {
      if (msg) msg.textContent = '⚠ Lost backend connection.';
      btn.disabled = false; btn.textContent = 'Retry';
      break;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Recent PDFs  (localStorage-backed)
// ──────────────────────────────────────────────────────────────────────────────

function saveRecentPDF(name) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('ks-recent-pdfs') || '[]'); } catch { list = []; }
  list = list.filter(n => n !== name);
  list.unshift(name);
  if (list.length > 10) list = list.slice(0, 10);
  localStorage.setItem('ks-recent-pdfs', JSON.stringify(list));
}

function renderRecentView() {
  const wrap = document.getElementById('recent-list');
  if (!wrap) return;
  let list = [];
  try { list = JSON.parse(localStorage.getItem('ks-recent-pdfs') || '[]'); } catch { list = []; }
  wrap.innerHTML = '';
  if (list.length === 0) {
    wrap.innerHTML = '<p class="empty-state">No recent documents yet. Open a PDF to get started.</p>';
    return;
  }
  list.forEach(name => {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.innerHTML = `
      <div class="recent-item-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="recent-item-info">
        <span class="recent-item-name">${escapeHTML(name)}</span>
        <span class="recent-item-sub">Click to re-import</span>
      </div>`;
    item.addEventListener('click', async () => {
      const subEl = item.querySelector('.recent-item-sub');
      subEl.textContent = 'Loading…';
      const buf = await getPdfFromCache(name);
      if (buf && _reopenPDF) {
        const file = new File([buf], name, { type: 'application/pdf' });
        _reopenPDF(file);
      } else {
        subEl.textContent = 'Not cached — please re-import';
        setTimeout(() => document.getElementById('pdf-input')?.click(), 400);
      }
    });
    wrap.appendChild(item);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Credits Modal
// ──────────────────────────────────────────────────────────────────────────────

function initCreditsModal() {
  const modal    = document.getElementById('credits-modal');
  const closeBtn = document.getElementById('credits-modal-close');
  const backdrop = modal?.querySelector('.credits-modal-backdrop');
  document.getElementById('credits-btn')?.addEventListener('click', () => modal?.classList.remove('hidden'));
  closeBtn?.addEventListener('click',  () => modal?.classList.add('hidden'));
  backdrop?.addEventListener('click',  () => modal?.classList.add('hidden'));
}

initCreditsModal();

