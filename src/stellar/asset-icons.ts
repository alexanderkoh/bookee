/**
 * Asset icons, resolved from the issuer's own stellar.toml.
 *
 * SEP-1 lets an issuer publish metadata — including an image — at
 * `https://<home_domain>/.well-known/stellar.toml`. That is the only
 * authoritative source for what an asset looks like, so it is the only one
 * used here. No third-party icon service is consulted, because doing so would
 * tell that service which assets a user holds.
 *
 * Native XLM is a deliberate gap: it has no issuer and therefore no TOML, and
 * no standard source publishes an icon for it. It falls back to the monogram
 * like any other unlabelled asset.
 *
 * Results are cached in the database — including failures — so browsing the
 * ledger never triggers network traffic.
 */
import type { Repositories } from "../db/repositories";
import type { Network } from "../db/schema";
import { nowIso } from "../lib/ids";
import { createLogger } from "../lib/log";

const log = createLogger("asset-icons");

/** Generous cap: an icon is a small image, not a payload. */
const MAX_ICON_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 8000;

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
]);

export type IconState = "ok" | "none" | "failed";

async function fetchWithTimeout(url: string, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { accept } });
  } finally {
    clearTimeout(timer);
  }
}

/** Untrusted input decides this URL, so only https is ever fetched. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Extracts the image URL for one asset from a stellar.toml document.
 *
 * Deliberately a narrow scan rather than a full TOML parser: the file is
 * untrusted third-party input and all that is needed is the image URL from the
 * [[CURRENCIES]] block whose code and issuer match.
 */
export function findIconUrl(toml: string, code: string, issuer: string): string | null {
  const blocks = toml.split(/\[\[CURRENCIES\]\]/i).slice(1);

  for (const block of blocks) {
    const value = (key: string): string | null => {
      const match = block.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "im"));
      return match?.[1] ?? null;
    };

    if (value("code") !== code) continue;
    // An issuer stated in the file must match; a file that omits it is trusted
    // only because it was fetched from that issuer's own declared domain.
    const declaredIssuer = value("issuer");
    if (declaredIssuer !== null && declaredIssuer !== issuer) continue;

    const image = value("image");
    if (image && /^https:\/\//i.test(image)) return image;
  }
  return null;
}

async function toDataUri(response: Response): Promise<string | null> {
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!ALLOWED_TYPES.has(type)) return null;

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_ICON_BYTES) return null;

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${type};base64,${btoa(binary)}`;
}

export interface IconLookup {
  state: IconState;
  dataUri?: string;
  sourceUrl?: string;
}

/** Resolves one asset's icon by way of its issuer's declared home domain. */
export async function resolveAssetIcon(
  issuer: string,
  code: string,
  homeDomain: string | null,
): Promise<IconLookup> {
  if (!homeDomain) return { state: "none" };

  try {
    const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;
    const tomlResponse = await fetchWithTimeout(tomlUrl, "text/plain");
    if (!tomlResponse.ok) return { state: "none" };

    const imageUrl = findIconUrl(await tomlResponse.text(), code, issuer);
    if (!imageUrl) return { state: "none" };

    // The URL comes from a third party's TOML and may point anywhere, so it is
    // held to https before it is fetched. Issuers legitimately serve icons from
    // a CDN, so the host is not restricted — but a plaintext fetch would leak
    // which assets you hold to anyone on the path, and is refused.
    if (!isHttpsUrl(imageUrl)) {
      log.warn("icon url is not https, refusing", { code, domain: homeDomain });
      return { state: "none" };
    }

    const imageResponse = await fetchWithTimeout(imageUrl, "image/*");
    if (!imageResponse.ok) return { state: "failed" };

    const dataUri = await toDataUri(imageResponse);
    if (!dataUri) return { state: "none" };

    return { state: "ok", dataUri, sourceUrl: imageUrl };
  } catch (error) {
    log.warn("icon lookup failed", {
      code,
      domain: homeDomain,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return { state: "failed" };
  }
}

interface PendingAsset {
  id: string;
  code: string;
  issuer: string;
}

/**
 * Fetches icons for assets that have not been looked up yet.
 *
 * Runs after a sync, once per asset for the lifetime of the database. Failures
 * are recorded rather than retried in a loop, and never interrupt anything:
 * a missing icon costs a monogram, not a broken ledger.
 */
export async function refreshAssetIcons(
  repositories: Repositories,
  network: Network,
  lookupHomeDomain: (issuer: string) => Promise<string | null>,
): Promise<number> {
  const pending = await repositories.driver.select<PendingAsset>(
    `SELECT id, code, issuer FROM assets
     WHERE network = ? AND issuer IS NOT NULL AND icon_state IS NULL
     LIMIT 25`,
    [network],
  );
  if (pending.length === 0) return 0;

  let resolved = 0;

  for (const asset of pending) {
    const homeDomain = await lookupHomeDomain(asset.issuer);
    const result = await resolveAssetIcon(asset.issuer, asset.code, homeDomain);

    await repositories.driver.execute(
      `UPDATE assets
       SET icon_data_uri = ?, icon_source_url = ?, icon_state = ?, icon_checked_at = ?
       WHERE id = ?`,
      [result.dataUri ?? null, result.sourceUrl ?? null, result.state, nowIso(), asset.id],
    );

    if (result.state === "ok") resolved += 1;
  }

  log.info("asset icons refreshed", { checked: pending.length, resolved });
  return resolved;
}
