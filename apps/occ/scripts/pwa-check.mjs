// Chromium's verdict on a deployed console: node scripts/pwa-check.mjs <url>
// Prints the manifest parse result, service worker state and cache contents, whether start_url is answered offline
// through the worker (Chrome Android's WebAPK check), and DevTools' installability errors.
import { chromium, devices } from "@playwright/test";
const url = process.argv[2] ?? "http://localhost:3000/";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
await page.addInitScript(() => { window.__bip = false; addEventListener("beforeinstallprompt", () => { window.__bip = true; }); });
const cdp = await ctx.newCDPSession(page);
await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
let sw = null;
for (let i = 0; i < 20 && sw?.state !== "activated"; i++) {
  await page.waitForTimeout(1500);
  sw = await page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return r ? { scope: r.scope, installing: !!r.installing, waiting: !!r.waiting, state: r.active?.state ?? null } : null; });
}
const { url: murl, errors } = await cdp.send("Page.getAppManifest");
console.log("manifest:", murl, "parse errors:", JSON.stringify(errors));
console.log("service worker:", JSON.stringify(sw));
const caches_ = await page.evaluate(async () => { const out = {}; for (const k of await caches.keys()) { const reqs = await (await caches.open(k)).keys(); const paths = reqs.map((r) => new URL(r.url).pathname); out[k] = { total: paths.length, shells: paths.filter((p) => !p.includes(".")).length, chunks: paths.filter((p) => p.startsWith("/_next/static/")).length, bundle: paths.filter((p) => p.startsWith("/static-runs/")).length }; } return out; });
console.log("caches:", JSON.stringify(caches_));
await ctx.setOffline(true);
const offline = await page.goto(new URL("/", url).href, { waitUntil: "domcontentloaded", timeout: 60000 }).then(async (r) => `${r?.status()} ${(await page.content()).length} bytes, title "${await page.title()}"`).catch((e) => "FAILED: " + String(e.message).slice(0, 120));
console.log("start_url offline through the worker:", offline);
await ctx.setOffline(false);
console.log("beforeinstallprompt fired (never does in headless):", await page.evaluate(() => window.__bip));
const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
console.log("installability errors:", JSON.stringify(installabilityErrors));
await browser.close();
