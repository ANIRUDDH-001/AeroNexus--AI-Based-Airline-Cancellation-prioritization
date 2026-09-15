// AeroNexus service worker: the app shell and the precomputed demo bundle stay available offline (spec §14, Phase 5).
// Engine calls are never cached here; the client's own static fallback answers when the engine is unreachable.
const VERSION = "aeronexus-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon.svg", "/geo/south-asia.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // the bundle and static assets: cache first, then network
  if (url.pathname.startsWith("/static-runs/") || url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/geo/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(caches.open(VERSION).then(async (c) => (await c.match(e.request)) ?? fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  // pages: network first, the cached shell when offline
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { caches.open(VERSION).then((c) => c.put("/", r.clone())); return r; }).catch(() => caches.match("/")));
  }
});
