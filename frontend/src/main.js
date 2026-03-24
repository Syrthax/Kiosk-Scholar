const BACKEND_URL = "http://127.0.0.1:8000";

async function checkBackend() {
  const statusEl = document.getElementById("backend-status");
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
    const data = await res.json();
    statusEl.textContent = `✅ Backend: ${data.message}`;
    statusEl.style.background = "#1a3a1a";
    statusEl.style.color = "#4caf50";
  } catch (e) {
    statusEl.textContent = "❌ Backend unreachable — make sure uvicorn is running on port 8000";
    statusEl.style.background = "#3a1a1a";
    statusEl.style.color = "#f44336";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  checkBackend();
});
