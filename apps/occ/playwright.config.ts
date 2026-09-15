import { defineConfig, devices } from "@playwright/test";

/** Two projects: desktop (1440×900) and phone (390×844). The static suite runs with the engine unreachable so it
 *  is deterministic; the engine suite is skipped unless ENGINE_URL is set (spec §13). */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 1,
  workers: 2,
  reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
