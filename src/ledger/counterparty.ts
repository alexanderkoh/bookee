/**
 * Direction and counterparty resolution.
 *
 * This is the step that turns a raw movement into bookkeeping. It is a pure
 * function of the movement plus the set of addresses the workspace owns, which
 * is exactly why it can be re-run: when the user adds a second tracked account,
 * history that previously looked like an ordinary incoming payment becomes an
 * internal transfer, and re-running this over stored entries corrects it
 * without touching Horizon.
 *
 * `direction` describes the effect on the workspace's holdings:
 *
 *   incoming  the workspace gained this asset
 *   outgoing  the workspace lost this asset
 *   internal  value moved between the workspace's own accounts, no net change
 *   neutral   no effect on the workspace
 */
import type { Direction } from "../db/schema";
import type { NormalizedMovement } from "../stellar/types";

export interface Resolution {
  direction: Direction;
  counterpartyAddress: string | null;
}

/** Set of owned public keys. Comparison is exact; Stellar keys are case-sensitive. */
export type OwnedAddresses = ReadonlySet<string>;

export function resolveDirection(
  movement: Pick<NormalizedMovement, "fromAddress" | "toAddress" | "relevantParty">,
  owned: OwnedAddresses,
): Resolution {
  const { fromAddress, toAddress, relevantParty } = movement;
  const fromOwned = fromAddress !== null && owned.has(fromAddress);
  const toOwned = toAddress !== null && owned.has(toAddress);

  // Path payment sides: only one endpoint is meaningful for this asset.
  if (relevantParty === "from") {
    if (!fromOwned) return { direction: "neutral", counterpartyAddress: null };
    return { direction: "outgoing", counterpartyAddress: toAddress };
  }

  if (relevantParty === "to") {
    if (!toOwned) return { direction: "neutral", counterpartyAddress: null };
    return { direction: "incoming", counterpartyAddress: fromAddress };
  }

  // Both endpoints owned: the asset never left the workspace.
  if (fromOwned && toOwned) {
    return { direction: "internal", counterpartyAddress: toAddress };
  }
  if (fromOwned) {
    return { direction: "outgoing", counterpartyAddress: toAddress };
  }
  if (toOwned) {
    return { direction: "incoming", counterpartyAddress: fromAddress };
  }

  // Neither side is ours. Do not invent a counterparty.
  return { direction: "neutral", counterpartyAddress: null };
}

/**
 * Whether a movement is worth storing for this workspace.
 *
 * Path payments emit a movement for each side; the side that does not involve
 * an owned account describes value that never touched the workspace and is
 * dropped rather than stored as a neutral entry.
 */
export function isRelevant(
  movement: Pick<NormalizedMovement, "fromAddress" | "toAddress" | "relevantParty">,
  owned: OwnedAddresses,
): boolean {
  return resolveDirection(movement, owned).direction !== "neutral";
}
