// Renders the PWA icons as PNG from public/icons/*.svg: node scripts/build-icons.mjs
// Android Chrome wants 192 and 512 px raster icons for the install banner; iOS ignores SVG apple-touch-icons
// and needs an opaque 180 px PNG (transparent corners turn black on the home screen).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const jobs = [
  { svg: "public/icons/icon.svg", size: 192, out: "public/icons/icon-192.png" },
  { svg: "public/icons/icon.svg", size: 512, out: "public/icons/icon-512.png" },
  { svg: "public/icons/maskable.svg", size: 512, out: "public/icons/maskable-512.png" },
  { svg: "public/icons/maskable.svg", size: 180, out: "public/icons/apple-touch-icon.png" },
];
const browser = await chromium.launch();
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
  const svg = readFileSync(j.svg, "utf8").replace(/width="\d+" height="\d+"/, `width="${j.size}" height="${j.size}"`);
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);
  await page.screenshot({ path: j.out, omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  await page.close();
  console.log("wrote", j.out);
}
await browser.close();
