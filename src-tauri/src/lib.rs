mod sql_batch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Migrations deliberately live in TypeScript (src/db/migrator.ts) rather
        // than being registered here, so the schema travels with the domain code
        // and stays usable by a future SQLite-WASM web build.
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // The updater verifies a minisign signature against the public key in
    // tauri.conf.json before it writes anything, so an unsigned or tampered
    // artifact is rejected rather than installed. Nothing is fetched until the
    // person clicks install; see src/features/updates.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .invoke_handler(tauri::generate_handler![sql_batch::sql_batch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
