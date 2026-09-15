// Screenshots of the console at the four review widths (spec §13): node scripts/shots.mjs [url] [outDir]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const url = process.argv[2] ?? "http://localhost:3000/";
const out = resolve(process.argv[3] ?? ".shots");
mkdirSync(out, { recursive: true });
const widths = [1440, 1024, 768, 390];
const browser = await chromium.launch();
for (const w of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 844 : 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", isMobile: w < 768, hasTouch: w < 768 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const file = resolve(out, `${w}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("wrote", file);
  await ctx.close();
}
await browser.close();
