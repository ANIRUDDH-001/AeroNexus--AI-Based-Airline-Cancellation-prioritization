// Ask Chromium why a page is (not) installable: node scripts/pwa-check.mjs [url]
import { chromium, devices } from "@playwright/test";
const url = process.argv[2] ?? "http://localhost:3000/";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(3000);
const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
const { url: murl, errors } = await cdp.send("Page.getAppManifest");
console.log("manifest:", murl, "parse errors:", JSON.stringify(errors));
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return r ? { scope: r.scope, active: !!r.active, state: r.active?.state } : null; });
console.log("service worker:", JSON.stringify(sw));
console.log("installability errors:", JSON.stringify(installabilityErrors, null, 1));
await browser.close();
