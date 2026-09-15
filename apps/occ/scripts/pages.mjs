// Screenshot every page at one width: node scripts/pages.mjs [base] [width] [outDir]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const w = Number(process.argv[3] ?? 1440);
const out = resolve(process.argv[4] ?? ".shots/pages");
mkdirSync(out, { recursive: true });
const q = process.env.SHOT_QUERY ?? "";
const pages = ["/", "/flights", "/runs", "/parameters", "/cases", "/data", "/how-it-works"];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 844 : 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", isMobile: w < 768, hasTouch: w < 768 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
for (const p of pages) {
  await page.goto(`${base}${p}${q}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const name = p === "/" ? "operations" : p.slice(1);
  await page.screenshot({ path: resolve(out, `${name}-${w}.png`), fullPage: true });
  console.log("wrote", `${name}-${w}.png`);
}
if (errors.length) console.log("console errors:\n" + [...new Set(errors)].join("\n"));
await browser.close();
