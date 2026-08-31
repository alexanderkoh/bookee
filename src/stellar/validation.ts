/**
 * Address validation.
 *
 * Uses the SDK's StrKey so the checksum is verified rather than the shape being
 * pattern-matched. Validation happens before any network request, so a typo
 * produces an immediate, clear message instead of a 404 from Horizon.
 */
import { StrKey } from "@stellar/stellar-sdk";
import { BRANDING } from "../branding";

export function isValidPublicKey(value: string): boolean {
  try {
    return StrKey.isValidEd25519PublicKey(value.trim());
  } catch {
    return false;
  }
}

/** True for a secret key. Used only to refuse it loudly. */
export function looksLikeSecretKey(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("S")) {
    try {
      return StrKey.isValidEd25519SecretSeed(trimmed);
    } catch {
      return trimmed.length === 56;
    }
  }
  return false;
}

export type AddressValidation = { ok: true; address: string } | { ok: false; message: string };

/**
 * Validates an address for tracking.
 *
 * A secret key is rejected with an explicit message: this application is
 * read-only and must never accept, store or transmit one.
 */
export function validateTrackableAddress(input: string): AddressValidation {
  const address = input.trim();

  if (address.length === 0) {
    return { ok: false, message: "Enter a Stellar public address." };
  }
  if (looksLikeSecretKey(address)) {
    return {
      ok: false,
      message: `That looks like a secret key. ${BRANDING.appName} is read-only and never accepts secret keys — paste the public address, which starts with G.`,
    };
  }
  if (!isValidPublicKey(address)) {
    return {
      ok: false,
      message:
        "That is not a valid Stellar public address. Public addresses start with G and are 56 characters long.",
    };
  }
  return { ok: true, address };
}
