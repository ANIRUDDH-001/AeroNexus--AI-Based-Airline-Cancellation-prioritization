// Screenshot the network map panel at 2x: node scripts/map-shot.mjs [url] [out.png]
import { chromium } from "@playwright/test";
const url = process.argv[2] ?? "http://localhost:3000/?day=ec993a529700&t=420";
const out = process.argv[3] ?? ".shots/map.png";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
const svg = page.getByRole("img", { name: /network map/i }).first();
await svg.waitFor({ timeout: 60000 });
await page.waitForTimeout(800);
await svg.locator("xpath=ancestor::*[self::section or self::div][2]").screenshot({ path: out });
await browser.close();
console.log("wrote", out);
