"use client";
import { useEffect } from "react";

/** Registers the service worker in production so the shell and the demo bundle work offline (spec Phase 5). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
