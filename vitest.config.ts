import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    // Most of this suite is pure domain logic (parsers, money, rules) plus
    // real-SQLite repository tests via node:sqlite, which need the node
    // environment. Component tests opt into jsdom per-file with:
    //   // @vitest-environment jsdom
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
