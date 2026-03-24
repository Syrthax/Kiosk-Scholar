const BACKEND_URL = "http://127.0.0.1:8000";

async function checkBackend() {
  const statusEl = document.getElementById("backend-status");
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    const data = await res.json();
    statusEl.textContent = `✅ ${data.message}`;
    statusEl.className = "backend-status ok";
  } catch {
    statusEl.textContent = "❌ Backend unreachable — run: uvicorn main:app";
    statusEl.className = "backend-status error";
  }
}

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

function renderPDFViewer(file) {
  const viewer = document.getElementById("pdf-viewer");
  const objectURL = URL.createObjectURL(file);
  viewer.innerHTML = `<embed src="${objectURL}" type="application/pdf" width="100%" height="100%" />`;
}

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

function showLoading(on) {
  const sidebar = document.getElementById("text-sidebar");
  if (on) sidebar.innerHTML = "<p class='sidebar-placeholder'>⏳ Extracting text…</p>";
}

window.addEventListener("DOMContentLoaded", () => {
  checkBackend();

  const uploadBtn = document.getElementById("upload-btn");
  const pdfInput = document.getElementById("pdf-input");
  const uploadArea = document.getElementById("upload-area");

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

  async function handleFile(file) {
    // Show filename + render PDF
    document.getElementById("pdf-info").classList.remove("hidden");
    document.getElementById("pdf-name").textContent = file.name;
    renderPDFViewer(file);

    showLoading(true);
    try {
      const data = await uploadPDF(file);
      document.getElementById("pdf-pages").textContent = `${data.total_pages} pages`;
      renderExtractedText(data);
    } catch (err) {
      document.getElementById("text-sidebar").innerHTML =
        `<p class="sidebar-placeholder error">❌ ${err.message}</p>`;
    }
  }
});
