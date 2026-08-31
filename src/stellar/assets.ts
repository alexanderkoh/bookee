/**
 * Asset identity.
 *
 * Two assets are the same only when their code AND issuer match. Sharing a code
 * means nothing: anyone can issue an asset called "USDC". Native XLM gets one
 * canonical representation per network.
 */
import type { Network } from "../db/schema";
import type { AssetRef } from "./types";

export const NATIVE_DISPLAY_CODE = "XLM";

interface AssetFields {
  asset_type: string;
  asset_code?: string | undefined;
  asset_issuer?: string | undefined;
}

/** Deterministic asset id, so the same asset always maps to the same row. */
export function assetId(
  network: Network,
  assetType: string,
  code: string | null,
  issuer: string | null,
): string {
  if (assetType === "native") return `${network}:native`;
  return `${network}:${code ?? "?"}:${issuer ?? "?"}`;
}

export function nativeAsset(network: Network): AssetRef {
  return {
    id: assetId(network, "native", null, null),
    network,
    assetType: "native",
    code: null,
    issuer: null,
    contractId: null,
    displayCode: NATIVE_DISPLAY_CODE,
  };
}

/** Builds an AssetRef from the asset_* fields Horizon puts on a record. */
export function assetFromFields(network: Network, fields: AssetFields): AssetRef {
  if (fields.asset_type === "native") return nativeAsset(network);

  const code = fields.asset_code ?? null;
  const issuer = fields.asset_issuer ?? null;
  return {
    id: assetId(network, fields.asset_type, code, issuer),
    network,
    assetType: fields.asset_type,
    code,
    issuer,
    contractId: null,
    displayCode: code ?? fields.asset_type,
  };
}

/** Builds an AssetRef from the source_asset_* fields on a path payment. */
export function sourceAssetFromPathPayment(
  network: Network,
  record: {
    source_asset_type: string;
    source_asset_code?: string | undefined;
    source_asset_issuer?: string | undefined;
  },
): AssetRef {
  return assetFromFields(network, {
    asset_type: record.source_asset_type,
    asset_code: record.source_asset_code,
    asset_issuer: record.source_asset_issuer,
  });
}
