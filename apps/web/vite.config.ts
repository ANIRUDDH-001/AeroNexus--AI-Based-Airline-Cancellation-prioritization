import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const STATIC_RUNS = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../data/static-runs");

/** Serves data/static-runs at /static-runs/ in dev and copies it into dist/ on build (Plan §20 demo fallback).
 *  The API client falls back to these precomputed files when the API cannot be reached. */
function staticRuns(): Plugin {
  let outDir = "dist";
  return {
    name: "aeronexus-static-runs",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use("/static-runs", (req, res, next) => {
        const name = (req.url ?? "/").split("?")[0].replace(/^\//, "");
        const file = join(STATIC_RUNS, name);
        if (!/^[\w.-]+\.json$/.test(name) || !existsSync(file)) return next();
        res.setHeader("Content-Type", "application/json");
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (!existsSync(STATIC_RUNS)) return;
      const dest = join(outDir, "static-runs");
      mkdirSync(dest, { recursive: true });
      for (const f of readdirSync(STATIC_RUNS)) if (f.endsWith(".json")) copyFileSync(join(STATIC_RUNS, f), join(dest, f));
    },
  };
}

// Local dev proxies /api -> FastAPI so the browser never needs CORS; production uses VITE_API_URL.
export default defineConfig({
  plugins: [react(), tailwindcss(), staticRuns()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
