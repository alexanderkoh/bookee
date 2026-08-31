/**
 * Saving and opening files through native dialogs.
 *
 * The application has no static filesystem scope. Access is granted per file by
 * the dialog plugin at the moment the user picks one, so these helpers are the
 * only way anything reaches the disk — and only ever a path a person chose.
 */
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * Prompts for a location and writes the text there.
 * Returns the path written, or null if the user cancelled.
 */
export async function saveTextFile(
  contents: string,
  options: { defaultPath?: string; filters?: FileFilter[]; title?: string },
): Promise<string | null> {
  const path = await save({
    ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
    ...(options.filters ? { filters: options.filters } : {}),
    ...(options.title ? { title: options.title } : {}),
  });
  if (!path) return null;

  await writeTextFile(path, contents);
  return path;
}

/**
 * Prompts for a file and reads it.
 * Returns null if the user cancelled.
 */
export async function openTextFile(options: {
  filters?: FileFilter[];
  title?: string;
}): Promise<{ path: string; contents: string } | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    ...(options.filters ? { filters: options.filters } : {}),
    ...(options.title ? { title: options.title } : {}),
  });
  if (typeof selected !== "string") return null;

  return { path: selected, contents: await readTextFile(selected) };
}
