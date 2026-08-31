/**
 * Asset icons come from third-party stellar.toml files, which makes every value
 * in them untrusted input arriving over the network.
 */
import { describe, it, expect } from "vitest";
import { findIconUrl, isHttpsUrl } from "../../src/stellar/asset-icons";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const TOML = `
[[CURRENCIES]]
code = "USDC"
issuer = "${ISSUER}"
image = "https://cdn.example.com/usdc.png"

[[CURRENCIES]]
code = "EURC"
issuer = "${ISSUER}"
image = "https://cdn.example.com/eurc.png"
`;

describe("findIconUrl", () => {
  it("matches on code and issuer together, never code alone", () => {
    expect(findIconUrl(TOML, "USDC", ISSUER)).toBe("https://cdn.example.com/usdc.png");
    // Sharing a code means nothing; a different issuer is a different asset.
    expect(findIconUrl(TOML, "USDC", "GDIFFERENTISSUER")).toBeNull();
  });

  it("returns null rather than guessing when the asset is absent", () => {
    expect(findIconUrl(TOML, "XLM", ISSUER)).toBeNull();
    expect(findIconUrl("", "USDC", ISSUER)).toBeNull();
  });
});

describe("isHttpsUrl", () => {
  /**
   * An issuer controls this URL. A plaintext fetch would tell anyone on the
   * path which assets the user holds, so it is refused rather than downgraded.
   */
  it("accepts https and nothing else", () => {
    expect(isHttpsUrl("https://cdn.example.com/a.png")).toBe(true);
    expect(isHttpsUrl("http://cdn.example.com/a.png")).toBe(false);
    expect(isHttpsUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpsUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
  });

  it("refuses anything that is not a URL at all", () => {
    expect(isHttpsUrl("")).toBe(false);
    expect(isHttpsUrl("cdn.example.com/a.png")).toBe(false);
  });
});
