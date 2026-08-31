/**
 * Single source of truth for product identity.
 *
 * Every user-visible string that names the application reads from here, so a
 * rename is a one-file change. The Tauri bundle identifier is deliberately NOT
 * here: it determines the installed app's data directory, so changing it
 * strands every existing user's local database.
 */
export const BRANDING = {
  /** Short name — sidebar, window title, dock. */
  appName: "Bookee",
  /** Full name, for the about screen and installers. */
  fullName: "Bookee: Stellar Bookkeeping",
  /** What it does, in one line. */
  tagline: "Stellar bookkeeping, on your machine.",
  /** Portable backup file extension, without the leading dot. */
  fileExtension: "bookee",
  /** Who made it. Shown in the sidebar footer and the about screen. */
  studio: "Bastian's Creative Studio",
  /** Public source repository. */
  repositoryUrl: "https://github.com/alexanderkoh/bookee",
  license: "Apache-2.0",
} as const;

export type Branding = typeof BRANDING;
