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
            // Extend PATH so python3 is found when launched from Finder (.app bundle).
            // Homebrew installs to /opt/homebrew (Apple Silicon) or /usr/local (Intel).
            let current_path = std::env::var("PATH").unwrap_or_default();
            std::env::set_var(
                "PATH",
                format!("/opt/homebrew/bin:/usr/local/bin:{current_path}"),
            );

            if port_in_use(8000) {
                println!("[Kiosk-Scholar] Backend already running on :8000 — skipping spawn");
            } else {
                let (backend_dir, python_path_extra) = if cfg!(debug_assertions) {
                    // Dev: derive path from compile-time manifest location.
                    // CARGO_MANIFEST_DIR = .../frontend/src-tauri
                    let bdir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .parent()
                        .unwrap() // src-tauri → frontend
                        .parent()
                        .unwrap() // frontend → project root
                        .join("backend");
                    (bdir, None::<std::path::PathBuf>)
                } else {
                    // Production: backend files are bundled as app resources.
                    // They land at <App>.app/Contents/Resources/backend/
                    let res = app.path()
                        .resource_dir()
                        .expect("Failed to resolve resource directory");
                    let packages = res.join("backend").join("packages");
                    (res.join("backend"), Some(packages))
                };

                println!("[Kiosk-Scholar] Backend dir: {}", backend_dir.display());

                let mut cmd = Command::new("python3");
                cmd.args([
                        "-m", "uvicorn",
                        "main:app",
                        "--host", "127.0.0.1",
                        "--port", "8000",
                    ])
                    .current_dir(&backend_dir);
                if let Some(pkgs) = python_path_extra {
                    println!("[Kiosk-Scholar] PYTHONPATH: {}", pkgs.display());
                    cmd.env("PYTHONPATH", pkgs);
                }
                match cmd.spawn() {
                    Ok(child) => {
                        *BACKEND.lock().unwrap() = Some(child);
                        println!("[Kiosk-Scholar] Python backend started on :8000");
                        std::thread::spawn(|| wait_for_backend(8000));
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
                        println!("[Kiosk-Scholar] Backend stopped");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
