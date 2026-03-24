import * as pdfjsLib from 'pdfjs-dist';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

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

// ── PDF Viewer (pdf.js canvas + textLayer) ──
let _pdfDoc = null;

async function renderPDFViewer(file) {
  const viewer = document.getElementById("pdf-viewer");
  viewer.innerHTML = '<p class="viewer-placeholder">Rendering PDF…</p>';

  // Destroy previous document to free memory
  if (_pdfDoc) {
    await _pdfDoc.destroy();
    _pdfDoc = null;
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
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
  // Scroll the PDF canvas viewer to the page
  const pdfViewer = document.getElementById("pdf-viewer");
  const pdfPageEl = pdfViewer?.querySelector(`.pdf-page-wrapper[data-page="${pageNum}"]`);
  if (pdfPageEl) {
    pdfPageEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Also highlight in sources tab
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
  initInsights();

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

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML.replace(/\n/g, "<br>");
}
