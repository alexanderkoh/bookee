/**
 * Bundled marks for well-known assets.
 *
 * The runtime path — read the issuer's stellar.toml and cache the image it
 * declares (SEP-1) — is architecturally the right one and works for the long
 * tail. It does not work for the two assets that matter most here:
 *
 *   XLM   has no issuer, therefore no stellar.toml, and no standard source
 *         publishes an icon for it at all.
 *   USDC  declares home_domain "circle.com" on-chain, which serves no
 *         stellar.toml (404). Its real metadata lives at centre.io, which is
 *         not discoverable from anything Horizon returns.
 *
 * So these two are bundled: they render instantly, offline, with no request.
 * Everything else still resolves through the issuer's own domain.
 */
import type { ReactNode } from "react";

/** The Stellar mark, drawn in currentColor so it works in both themes. */
function StellarMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M38.975 10.813l-5.044 2.57L9.576 25.788a14.509 14.509 0 0121.459-14.542l2.887-1.471.43-.22A17.722 17.722 0 006.274 25.247a3.224 3.224 0 01-1.75 3.116L3 29.139v3.62l4.482-2.284 1.451-.74 1.43-.729 25.675-13.082 2.885-1.47 5.964-3.038V7.797l-5.912 3.016zm5.912 4.225L11.822 31.873l-2.885 1.473L3 36.371v3.617l5.896-3.004 5.043-2.57 24.38-12.422a14.509 14.509 0 01-21.48 14.553l-.177.094-3.13 1.595a17.722 17.722 0 0028.081-15.696 3.225 3.225 0 011.75-3.116l1.524-.776v-3.608z"
        fill="currentColor"
      />
    </svg>
  );
}

export interface BundledIcon {
  /** Rendered inside the circular mark. */
  render: (size: number) => ReactNode;
  /** Background of the circle; the artwork sits on it. */
  background: string;
  foreground: string;
}

/** Circle's USDC icon, as declared by the issuer at centre.io. */
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_TESTNET_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const STELLAR: BundledIcon = {
  render: (size) => <StellarMark size={Math.round(size * 0.72)} />,
  // Stellar's own brand black, with the mark knocked out in white.
  background: "#0f0f14",
  foreground: "#ffffff",
};

export const BUNDLED_ICONS: Record<string, BundledIcon> = {
  "public:native": STELLAR,
  "testnet:native": STELLAR,
};

/** USDC uses a real raster mark, registered separately so the data stays out of this file. */
export function registerUsdcIcon(dataUri: string): void {
  const icon: BundledIcon = {
    render: (size) => (
      <img src={dataUri} alt="" width={size} height={size} style={{ width: size, height: size }} />
    ),
    background: "transparent",
    foreground: "inherit",
  };
  BUNDLED_ICONS[`public:USDC:${USDC_ISSUER}`] = icon;
  BUNDLED_ICONS[`testnet:USDC:${USDC_TESTNET_ISSUER}`] = icon;
}
