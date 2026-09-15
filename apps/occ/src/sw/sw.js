// AeroNexus service worker (spec §14, Phase 5). Source: src/sw/sw.js — scripts/sync-static.mjs stamps the build id
// and the bundle file list into the two placeholders below and writes public/sw.js before every dev and build, so
// each deploy ships a new worker that re-precaches and drops the previous cache.
//
// Offline promise: every page shell, its scripts and fonts, the icons, the map land and the whole precomputed demo
// bundle are stored at install. Engine calls are never cached; the client's own static fallback answers from the
// bundle when the engine is unreachable, and the bundle is here even with no network at all.
const BUILD = "__BUILD__";
const CACHE = `aeronexus-${BUILD}`;
const ROUTES = ["/", "/flights", "/runs", "/parameters", "/cases", "/data", "/how-it-works"];
const ASSETS = ["/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png", "/geo/south-asia.json"];
const BUNDLE = __BUNDLE__;

const addAllSettled = async (cache, urls) => {
  const results = await Promise.allSettled(urls.map((u) => cache.add(new Request(u, { cache: "reload" }))));
  return results.filter((r) => r.status === "rejected").length;
};

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const failed = await addAllSettled(cache, [...ROUTES, ...ASSETS, ...BUNDLE]);
    // the scripts and styles each shell references, then the fonts the styles reference
    const assets = new Set();
    for (const route of ROUTES) {
      const html = await cache.match(route).then((r) => r?.text()).catch(() => null);
      for (const m of (html ?? "").matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) assets.add(m[0]);
    }
    await addAllSettled(cache, [...assets]);
    const fonts = new Set();
    for (const a of assets) {
      if (!a.endsWith(".css")) continue;
      const css = await cache.match(a).then((r) => r?.text()).catch(() => null);
      for (const m of (css ?? "").matchAll(/\/_next\/static\/media\/[^"'\s)]+/g)) fonts.add(m[0]);
    }
    await addAllSettled(cache, [...fonts]);
    if (failed) console.warn(`[sw] ${failed} precache request(s) failed`);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const cacheFirst = async (req) => {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
};

const networkFirst = async (req, key = req) => {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith("/api/")) return; // the engine: never cached
  if (p.startsWith("/_next/static/")) return e.respondWith(cacheFirst(req)); // content-hashed, immutable
  if (req.mode === "navigate") {
    // the shell for this route, then the operations shell (client routing takes it from there)
    return e.respondWith(networkFirst(req, p).catch(async () => (await caches.match(p)) ?? (await caches.match("/")) ?? Response.error()));
  }
  if (req.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return e.respondWith(networkFirst(req)); // client-side navigations
  if (p.startsWith("/static-runs/") || p.startsWith("/geo/") || p.startsWith("/icons/") || p === "/manifest.webmanifest") return e.respondWith(networkFirst(req, p));
});
