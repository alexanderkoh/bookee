import "@testing-library/jest-dom/vitest";

/**
 * Vitest setup.
 *
 * node:sqlite is still flagged experimental in Node 24 and prints a warning on
 * first use. The suite depends on it deliberately (real SQLite, no Tauri), so
 * the warning is suppressed to keep test output readable.
 */
const originalEmit = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message;
  if (text.includes("SQLite is an experimental feature")) return;
  return (originalEmit as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
