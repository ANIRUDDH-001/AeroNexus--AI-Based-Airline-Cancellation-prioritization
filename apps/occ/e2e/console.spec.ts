import { expect, test } from "@playwright/test";

/** The static suite (spec §13) runs against a console whose engine is unreachable, so the precomputed bundle
 *  answers and the run is deterministic. Start the console with NEXT_PUBLIC_API_URL pointing at a closed port:
 *    NEXT_PUBLIC_API_URL=http://127.0.0.1:9 npm run dev
 *  The engine suite runs only when ENGINE_URL is set and the console proxies to a live engine. */
const LIVE = !!process.env.ENGINE_URL;

test.describe("console", () => {
  test("shell renders with the decision cluster and no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByRole("link", { name: "AeroNexus" })).toBeVisible();
    await expect(page.getByLabel(/Decision time/)).toBeVisible();
    await expect(page.getByLabel(/Engine status/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("navigation keeps the day and time in the URL", async ({ page, isMobile }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/day=/);
    if (isMobile) {
      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("link", { name: "Runs" }).click();
    } else {
      await page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Runs" }).click();
    }
    await expect(page).toHaveURL(/\/runs\?day=.*&t=\d+/);
  });
});

test.describe("demo mode (engine unreachable)", () => {
  test.skip(LIVE, "runs against the precomputed bundle only");
  test("shows the demo pill, the headline and the precomputed recommendation", async ({ page, isMobile }) => {
    await page.goto("/");
    await expect(page.getByLabel("Demo data, precomputed, read-only")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/If nobody acts|running to plan|at risk/);
    await expect(page.getByText(/have already departed/)).toBeVisible();
    if (isMobile) await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Plans", exact: true }).click();
    // the bundle lists its runs, so the latest one at this decision time loads by itself; otherwise ask for it
    const invite = page.getByRole("button", { name: "Load the precomputed recommendation" });
    if (await invite.isVisible().catch(() => false)) await invite.click();
    await expect(page.getByRole("article", { name: /Recommended: plan 1/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Demo result").first()).toBeVisible();
    await expect(page.getByText("Impact avoided if we act").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Accept plan 1/ })).toBeDisabled();
  });

  test("the board switches views and definitions open", async ({ page, isMobile }) => {
    await page.goto("/");
    if (isMobile) await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Board", exact: true }).click();
    const board = page.getByRole("radiogroup", { name: "Board view" });
    await expect(board).toBeVisible();
    await board.getByRole("radio", { name: "Changes only" }).click();
    await expect(page.getByText(/Pick a plan below|changes on/)).toBeVisible();
    await page.getByRole("button", { name: "Show all", exact: true }).click();
    await expect(board.getByRole("radio", { name: "If nobody acts" })).toHaveAttribute("aria-checked", "true");
  });

  test("every page renders", async ({ page }) => {
    for (const path of ["/flights", "/runs", "/parameters", "/cases", "/data", "/how-it-works"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });
});

test.describe("engine suite", () => {
  test.skip(!LIVE, "needs ENGINE_URL and a live engine");
  test("gets a live recommendation and shows changes on the board", async ({ page, isMobile }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await expect(page.getByLabel(/Engine status: Engine online/)).toBeVisible({ timeout: 30_000 });
    if (isMobile) await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Plans", exact: true }).click();
    const run = page.getByRole("button", { name: /Get a recommendation|Run again/ });
    await run.click();
    await expect(page.getByRole("article", { name: /Recommended: plan 1/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Live engine").first()).toBeVisible();
  });
});
