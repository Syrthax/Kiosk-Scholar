use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;

// Holds the spawned backend process so we can kill it on exit.
static BACKEND: Mutex<Option<std::process::Child>> = Mutex::new(None);

/// Returns true when something is already listening on 127.0.0.1:<port>.
fn port_in_use(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_err()
}

/// Block until the backend HTTP server responds on /health (max ~15 s).
fn wait_for_backend(port: u16) {
    let url = format!("http://127.0.0.1:{}/health", port);
    for _ in 0..30 {
        if let Ok(stream) = std::net::TcpStream::connect(format!("127.0.0.1:{}", port)) {
            drop(stream);
            println!("[Kiosk-Scholar] Backend is ready on :{}", port);
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    eprintln!("[Kiosk-Scholar] Backend did not become ready in time on :{} ({})", port, url);
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if port_in_use(8000) {
                println!("[Kiosk-Scholar] Backend already running on :8000 — skipping spawn");
                return Ok(());
            }

            // Resolve the bundled backend.exe path.
            // In production Tauri copies resources into the resource directory.
            // We try two locations in order:
            //   1. resource_dir()  — where Tauri copies bundled resources on install
            //   2. exe parent dir  — works when running the raw .exe from target/release
            let resource_dir = app.path().resource_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| std::path::PathBuf::from("."));

            let candidates = [
                resource_dir.join("backend.exe"),
                exe_dir.join("backend.exe"),
            ];

            let bundled = candidates.iter().find(|p| p.exists()).cloned();

            let result = if let Some(backend_exe) = bundled {
                // Production: run the bundled self-contained backend.exe
                println!("[Kiosk-Scholar] Starting bundled backend: {:?}", backend_exe);
                Command::new(&backend_exe)
                    .current_dir(backend_exe.parent().unwrap_or(std::path::Path::new(".")))
                    .spawn()
            } else {
                // Dev: run uvicorn from the source tree
                let backend_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent().unwrap()
                    .parent().unwrap()
                    .join("backend");
                println!("[Kiosk-Scholar] Dev mode: starting uvicorn from {:?}", backend_dir);
                // Try python / python3 / py in order
                let python = ["python", "python3", "py"]
                    .iter()
                    .find(|&&p| Command::new(p).arg("--version").output().is_ok())
                    .copied()
                    .unwrap_or("python");
                Command::new(python)
                    .args(["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"])
                    .current_dir(&backend_dir)
                    .spawn()
            };

            match result {
                Ok(child) => {
                    *BACKEND.lock().unwrap() = Some(child);
                    println!("[Kiosk-Scholar] Backend process spawned — waiting for readiness...");
                    // Wait in a background thread so we don't block the UI
                    std::thread::spawn(|| wait_for_backend(8000));
                }
                Err(e) => eprintln!("[Kiosk-Scholar] Failed to start backend: {e}"),
            }

            Ok(())
        })
        // Kill the backend when the last window is destroyed.
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut guard) = BACKEND.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        println!("[Kiosk-Scholar] Backend stopped");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
