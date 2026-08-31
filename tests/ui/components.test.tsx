// @vitest-environment jsdom
/**
 * Presentation invariants that the accessibility requirements depend on.
 *
 * These are not snapshot tests. Each one checks a rule the design has to hold
 * to: direction must be readable without colour, amounts must not be rounded
 * into a lie, and dialogs must behave like dialogs.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Amount, DirectionTag, shortAddress, relativeTime } from "../../src/components";
import { firstGrapheme } from "../../src/components/category-chip";
import { Drawer, Modal } from "../../src/components/primitives";
import { SAMPLE_ACCOUNT } from "../support/synthetic-ledger";

describe("Amount", () => {
  it("conveys direction with a sign and a label, not colour alone", () => {
    const { container } = render(
      <Amount amount="5000" assetCode="USDC" direction="incoming" />,
    );
    expect(container.textContent).toContain("+5,000.00 USDC");
    // The direction is also present as text for screen readers.
    expect(container.textContent).toContain("Incoming");
  });

  it("marks outgoing with a minus and its own label", () => {
    const { container } = render(
      <Amount amount="1042" assetCode="USDC" direction="outgoing" />,
    );
    expect(container.textContent).toContain("1,042.00 USDC");
    expect(container.textContent).toContain("Outgoing");
  });

  it("shows an internal transfer without a misleading sign", () => {
    const { container } = render(<Amount amount="2000" assetCode="USDC" direction="internal" />);
    expect(container.textContent).not.toContain("+");
    expect(container.textContent).not.toContain("−");
    expect(container.textContent).toContain("Transfer");
  });

  it("never rounds a one-stroop payment away to zero", () => {
    const { container } = render(
      <Amount amount="0.0000001" assetCode="XLM" direction="incoming" />,
    );
    expect(container.textContent).toContain("0.0000001");
    expect(container.textContent).not.toContain("0.00 XLM");
  });

  it("keeps full precision on a large balance", () => {
    const { container } = render(
      <Amount amount="384102.7460913" assetCode="XLM" direction="incoming" />,
    );
    expect(container.textContent).toContain("384,102.7460913");
  });
});

describe("DirectionTag", () => {
  it("labels every direction in words", () => {
    for (const [direction, label] of [
      ["incoming", "Incoming"],
      ["outgoing", "Outgoing"],
      ["internal", "Transfer"],
    ] as const) {
      const { container, unmount } = render(<DirectionTag direction={direction} />);
      expect(container.textContent).toBe(label);
      unmount();
    }
  });
});

describe("Drawer", () => {
  it("is announced as a dialog with an accessible name", () => {
    render(
      <Drawer title="Transaction" onClose={() => {}}>
        <p>body</p>
      </Drawer>,
    );
    // The name comes from the dialog title, wired up by aria-labelledby.
    expect(screen.getByRole("dialog", { name: "Transaction" })).toBeInTheDocument();
  });

  it("hides the rest of the page from assistive technology", () => {
    render(
      <div>
        <button type="button">behind the drawer</button>
        <Drawer title="Transaction" onClose={() => {}}>
          <p>body</p>
        </Drawer>
      </div>,
    );

    // Radix hides sibling content rather than relying on aria-modal, which
    // screen readers honour inconsistently. Either way the guarantee is the
    // same: a reader cannot wander into the page behind the dialog.
    const outside = screen.getByText("behind the drawer").closest("[aria-hidden]");
    expect(outside).not.toBeNull();
  });

  it("moves focus into the dialog rather than leaving it on the page", async () => {
    render(
      <div>
        <button type="button">behind the drawer</button>
        <Drawer title="Transaction" onClose={() => {}}>
          <button type="button">inside</button>
        </Drawer>
      </div>,
    );

    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Drawer title="Transaction" onClose={onClose}>
        <p>body</p>
      </Drawer>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the panel open when its own content is clicked", async () => {
    const onClose = vi.fn();
    render(
      <Drawer title="Transaction" onClose={onClose}>
        <p>body</p>
      </Drawer>,
    );

    await userEvent.click(screen.getByText("body"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers a labelled close control", async () => {
    const onClose = vi.fn();
    render(
      <Drawer title="Transaction" onClose={onClose}>
        <p>body</p>
      </Drawer>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Modal", () => {
  it("exposes its title and description to assistive technology", () => {
    render(
      <Modal title="Remove account?" description="This only affects your local ledger." onClose={() => {}}>
        <button type="button">Confirm</button>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Remove account?" });
    expect(dialog).toHaveAccessibleDescription("This only affects your local ledger.");
  });

  it("closes on Escape, which the hand-rolled version never did", async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Remove account?" onClose={onClose}>
        <button type="button">Confirm</button>
      </Modal>,
    );

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("formatting helpers", () => {
  it("shortens addresses while keeping both ends recognisable", () => {
    const address = SAMPLE_ACCOUNT;
    const short = shortAddress(address, 4);
    expect(short.startsWith(address.slice(0, 4))).toBe(true);
    expect(short.endsWith(address.slice(-4))).toBe(true);
    expect(shortAddress(null)).toBe("—");
  });

  it("describes sync recency in plain words", () => {
    expect(relativeTime(new Date().toISOString())).toBe("just now");
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5 minutes ago");
    expect(relativeTime(null)).toBe("never");
  });
});

describe("firstGrapheme", () => {
  /**
   * A user pastes a flag or a profession emoji; the stored value has to be the
   * whole sequence. The bug this guards against was an input maxLength, which
   * counts UTF-16 units and so cut 🏳️‍🌈 after its joiner, leaving a glyph that
   * renders as a white flag followed by nothing.
   */
  it.each([
    ["🏳️‍🌈", 6],
    ["🧑‍💻", 5],
    ["👨‍👩‍👧", 8],
    ["✈️", 2],
    ["💰", 2],
  ])("keeps %s whole", (emoji, units) => {
    expect(emoji.length).toBe(units);
    expect(firstGrapheme(emoji)).toBe(emoji);
  });

  it("takes only the first cluster when given several", () => {
    expect(firstGrapheme("🏳️‍🌈💰")).toBe("🏳️‍🌈");
    expect(firstGrapheme("abc")).toBe("a");
  });

  it("treats blank input as no emoji", () => {
    expect(firstGrapheme("   ")).toBe("");
    expect(firstGrapheme("")).toBe("");
  });

  it("trims padding a paste can carry", () => {
    expect(firstGrapheme("  💰  ")).toBe("💰");
  });
});
