use std::process::Command;
use std::sync::Mutex;

// Holds the spawned Python backend process so we can kill it on exit.
static BACKEND: Mutex<Option<std::process::Child>> = Mutex::new(None);

/// Returns true when something is already listening on 127.0.0.1:<port>.
fn port_in_use(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            if port_in_use(8000) {
                println!("[Kiosk-Scholar] Backend already running on :8000 — skipping spawn");
            } else {
                // CARGO_MANIFEST_DIR == .../frontend/src-tauri at compile time,
                // so two .parent() calls reach the project root, then /backend.
                let backend_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap() // frontend/src-tauri → frontend
                    .parent()
                    .unwrap() // frontend → Kiosk-Scholar (project root)
                    .join("backend");

                match Command::new("python3")
                    .args([
                        "-m", "uvicorn",
                        "main:app",
                        "--host", "127.0.0.1",
                        "--port", "8000",
                    ])
                    .current_dir(&backend_dir)
                    .spawn()
                {
                    Ok(child) => {
                        *BACKEND.lock().unwrap() = Some(child);
                        println!("[Kiosk-Scholar] Python backend started on :8000");
                    }
                    Err(e) => eprintln!("[Kiosk-Scholar] Failed to start backend: {e}"),
                }
            }
            Ok(())
        })
        // Kill the backend when the last window is destroyed.
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut guard) = BACKEND.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        println!("[Kiosk-Scholar] Python backend stopped");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
