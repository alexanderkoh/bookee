/**
 * Semantic version comparison.
 *
 * Small on purpose: the only question ever asked is "is the released version
 * newer than the one running", and a dependency for that would be silly.
 * Pre-release suffixes are treated as older than the release they precede, so
 * 0.2.0-beta.1 never masquerades as newer than 0.2.0.
 */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/** Returns 1 if a is newer than b, -1 if older, 0 if equivalent. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }

  // Equal numbers: a release beats a pre-release of the same number.
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease > right.prerelease ? 1 : -1;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
