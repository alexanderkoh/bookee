import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const host = process.env["TAURI_DEV_HOST"];

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // The running version, so the update check can compare against a release.
  define: { __APP_VERSION__: JSON.stringify(version) },

  // sqlite-wasm ships a .wasm asset that must not be pre-bundled.
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Vite options tailored for Tauri development, applied in `tauri dev` / `tauri build`.
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
});
