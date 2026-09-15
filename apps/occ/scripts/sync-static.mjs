// Runs before dev and build: copies the precomputed demo bundle (data/static-runs) into public/ so the UI can
// serve it when the engine is asleep, then writes public/sw.js from src/sw/sw.js with this build's stamp and
// the bundle's file list, so the service worker precaches the whole bundle and refreshes on every deploy.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../../data/static-runs");
const dst = resolve(here, "../public/static-runs");
if (existsSync(src)) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true, filter: (p) => !p.endsWith("desktop.ini") });
  console.log("static-runs synced");
}
const bundle = existsSync(dst) ? readdirSync(dst).filter((f) => f.endsWith(".json")).map((f) => `/static-runs/${f}`) : [];
const stamp = `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
const sw = readFileSync(resolve(here, "../src/sw/sw.js"), "utf8").replaceAll("__BUILD__", stamp).replaceAll("__BUNDLE__", JSON.stringify(bundle));
writeFileSync(resolve(here, "../public/sw.js"), sw);
console.log(`sw.js written (build ${stamp}, ${bundle.length} bundle files precached)`);
