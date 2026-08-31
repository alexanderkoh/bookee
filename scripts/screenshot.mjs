#!/usr/bin/env node
/**
 * Captures every screen of the preview build.
 *
 * This is how the interface gets reviewed without a native build and without
 * capturing the developer's desktop. It drives the real application — real
 * repositories, real SQL, real components — against seeded data in SQLite-WASM.
 *
 * Usage:
 *   pnpm dev:preview            # in one terminal
 *   pnpm preview:shots          # in another
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.PREVIEW_URL ?? "http://localhost:5273";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "screenshots");

const SCREENS = [
  { name: "01-overview", path: "/" },
  { name: "02-ledger", path: "/transactions" },
  { name: "03-contacts", path: "/contacts" },
  { name: "04-categories", path: "/categories" },
  { name: "05-rules", path: "/rules" },
  { name: "06-accounts", path: "/accounts" },
  { name: "07-data", path: "/data" },
  { name: "08-settings", path: "/settings" },
];

const INTERACTIONS = [
  {
    name: "10-workspace-menu",
    path: "/",
    run: async (page) => {
      await page.getByRole("button", { name: "Switch ledger" }).click();
      await page.waitForSelector(".menu", { timeout: 5000 });
    },
  },
  {
    name: "11-new-ledger",
    path: "/",
    run: async (page) => {
      await page.getByRole("button", { name: "Switch ledger" }).click();
      await page.getByRole("button", { name: "New ledger" }).click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    },
  },
  {
    name: "12-transaction-detail",
    path: "/transactions",
    run: async (page) => {
      // The virtualizer's spacer rows are aria-hidden; click a real one.
      await page.locator('tbody tr:not([aria-hidden="true"])').first().click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    },
  },
  {
    name: "13-rule-editor",
    path: "/rules",
    run: async (page) => {
      await page.getByRole("button", { name: "New rule" }).first().click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    },
  },
];

const THEMES = process.env.THEME ? [process.env.THEME] : ["light", "dark"];

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const failures = [];

  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    const page = await context.newPage();

    // Surface application errors rather than silently shooting a broken page.
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`console: ${message.text()}`);
    });

    for (const screen of SCREENS) {
      await page.goto(`${BASE}${screen.path}`, { waitUntil: "networkidle" });
      // The seed runs in the browser; wait for the shell rather than a timer.
      await page.waitForSelector(".layout, .onboarding", { timeout: 30_000 });
      await page.waitForTimeout(450);

      const file = join(OUT, `${screen.name}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: false });
      console.log(`  ${screen.name} (${theme})`);
    }

    // Interaction states: a static screenshot cannot show whether a menu or a
    // dialog actually works, and those are exactly the parts that break.
    for (const flow of INTERACTIONS) {
      await page.goto(`${BASE}${flow.path}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".layout", { timeout: 30_000 });
      await page.waitForTimeout(350);
      try {
        await flow.run(page);
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(OUT, `${flow.name}-${theme}.png`) });
        console.log(`  ${flow.name} (${theme})`);
      } catch (error) {
        failures.push(`interaction ${flow.name}: ${error.message}`);
      }
    }

    await context.close();
  }

  await browser.close();

  if (failures.length > 0) {
    console.error("\nPage errors detected:");
    for (const failure of new Set(failures)) console.error("  " + failure);
    process.exitCode = 1;
  } else {
    console.log(`\nAll screens captured to ${OUT}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
