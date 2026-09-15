// Copies the precomputed demo bundle (data/static-runs) into public/ so the UI can serve it when the
// engine is asleep. Runs before dev and build; harmless when the bundle is absent.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
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
