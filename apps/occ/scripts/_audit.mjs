import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const base = "http://localhost:3000";
const q = process.argv[2] ?? "?day=ec993a529700&t=420";
const out = process.argv[3];
const pages = ["/", "/?view=board", "/?view=map", "/?view=plans", "/flights", "/runs", "/parameters", "/cases", "/data", "/how-it-works"];
const browser = await chromium.launch();
let text = "";
for (const w of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 844 : 900 }, isMobile: w < 768, hasTouch: w < 768, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
  for (const p of pages) {
    if (w === 1440 && p.includes("view=")) continue;
    const sep = p.includes("?") ? "&" : "";
    await page.goto(`${base}${p}${p.includes("?") ? sep + q.slice(1) : q}`, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(1500);
    const main = await page.locator("main").innerText().catch(() => "(no main)");
    text += `\n\n===== ${w}px ${p} =====\n${main.replace(/\n{3,}/g, "\n\n")}`;
  }
  text += `\n\n===== ${w}px console errors =====\n${[...new Set(errors)].join("\n") || "(none)"}`;
  await ctx.close();
}
writeFileSync(out, text);
console.log("wrote", out, text.length, "chars");
await browser.close();
