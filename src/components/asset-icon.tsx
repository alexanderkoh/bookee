/**
 * Asset marks.
 *
 * A real icon is shown when the issuer publishes one in its stellar.toml.
 * Everything else — including native XLM, which no standard source publishes an
 * icon for — gets a monogram whose colour is derived from the asset's identity.
 *
 * The colour comes from the full asset id, not the code, so two different
 * assets both calling themselves "USDC" are visibly different rather than
 * quietly interchangeable.
 */
import { useQuery } from "@tanstack/react-query";
import { useRepositories } from "../app/providers/app-context";
import { BUNDLED_ICONS, registerUsdcIcon } from "../assets/known-asset-icons";
import { USDC_ICON_DATA_URI } from "../assets/usdc-icon";

registerUsdcIcon(USDC_ICON_DATA_URI);

/**
 * Hues chosen to stay distinguishable from each other and from the direction
 * colours, so an asset mark is never mistaken for a positive/negative signal.
 */
const HUES = [214, 262, 292, 340, 12, 32, 158, 188];

function hueFor(assetId: string): number {
  let hash = 0;
  for (let index = 0; index < assetId.length; index++) {
    hash = (hash * 31 + assetId.charCodeAt(index)) | 0;
  }
  return HUES[Math.abs(hash) % HUES.length]!;
}

function monogram(code: string): string {
  // Three characters still reads at 18px and keeps XLM as "XLM" rather than
  // the meaningless "XL". Beyond that it turns to mush.
  return code.slice(0, 3).toUpperCase();
}

/** Monogram type shrinks with length so three characters still fit the circle. */
function monogramScale(length: number): number {
  if (length >= 3) return 0.3;
  if (length === 2) return 0.38;
  return 0.46;
}

export function AssetIcon({
  assetId,
  code,
  size = 18,
  iconDataUri,
}: {
  assetId: string;
  code: string;
  size?: number;
  /** Pass through when already loaded, to avoid a per-row query. */
  iconDataUri?: string | null;
}) {
  // A bundled mark wins: it is the real artwork, needs no network, and covers
  // the assets the issuer-TOML route cannot reach.
  const bundled = BUNDLED_ICONS[assetId];
  if (bundled) {
    return (
      <span
        className="asset-icon asset-icon--bundled"
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          background: bundled.background,
          color: bundled.foreground,
        }}
      >
        {bundled.render(size)}
      </span>
    );
  }

  const hue = hueFor(assetId);

  if (iconDataUri) {
    return (
      <img
        className="asset-icon"
        src={iconDataUri}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="asset-icon asset-icon--monogram"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(7, Math.round(size * monogramScale(monogram(code).length))),
        background: `hsl(${hue} 62% 92%)`,
        color: `hsl(${hue} 58% 32%)`,
      }}
    >
      {monogram(code)}
    </span>
  );
}

/** Asset code with its mark, the standard way an asset is named in the UI. */
export function AssetLabel({
  assetId,
  code,
  iconDataUri,
  size,
}: {
  assetId: string;
  code: string;
  iconDataUri?: string | null;
  size?: number;
}) {
  return (
    <span className="asset-label">
      <AssetIcon
        assetId={assetId}
        code={code}
        iconDataUri={iconDataUri}
        {...(size ? { size } : {})}
      />
      <span>{code}</span>
    </span>
  );
}

export interface AssetIconRecord {
  id: string;
  display_code: string;
  icon_data_uri: string | null;
}

/**
 * All cached icons for a workspace, fetched once and shared.
 *
 * A per-row query would be an N+1 against a table the ledger renders hundreds
 * of times.
 */
export function useAssetIcons(): Map<string, string | null> {
  const repositories = useRepositories();

  const { data } = useQuery({
    queryKey: ["asset-icons"],
    staleTime: 5 * 60_000,
    queryFn: () =>
      repositories.driver.select<AssetIconRecord>(
        "SELECT id, display_code, icon_data_uri FROM assets",
      ),
  });

  return new Map((data ?? []).map((row) => [row.id, row.icon_data_uri]));
}
