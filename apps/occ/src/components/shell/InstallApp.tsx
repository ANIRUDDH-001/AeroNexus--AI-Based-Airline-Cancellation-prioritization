"use client";
import { useCallback, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
declare global {
  interface Window { __axInstall?: InstallPrompt | null }
}

// Chrome fires beforeinstallprompt once, early; a script in the root layout parks it on window.__axInstall and
// announces it, so the button can appear whenever the Pages sheet opens.
const subscribe = (cb: () => void) => {
  window.addEventListener("ax:installable", cb);
  window.addEventListener("appinstalled", cb);
  return () => {
    window.removeEventListener("ax:installable", cb);
    window.removeEventListener("appinstalled", cb);
  };
};
type Snapshot = "standalone" | "prompt" | "ios" | "none";
// state plus the two facts a phone needs to explain a missing install offer (a secure origin and a worker in
// control), as one string so the store snapshot stays stable
const snapshot = (): string => {
  const https = location.protocol === "https:" || location.hostname === "localhost";
  const sw = !!navigator.serviceWorker?.controller;
  let state: Snapshot = "none";
  if (window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone)) state = "standalone";
  else if (window.__axInstall) state = "prompt";
  else {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios) state = "ios";
  }
  return `${state}|${https ? "https" : "http"}|${sw ? "sw" : "nosw"}|${navigator.maxTouchPoints > 0 ? "touch" : "mouse"}`;
};

/** The install row of the Pages sheet: a real install button where the browser offers one (Chrome, Edge,
 *  Samsung Internet), the Share → Add to Home Screen route on iOS, nothing once installed. */
export function InstallApp() {
  const [state, secure, worker, touch] = useSyncExternalStore(subscribe, snapshot, () => "none|https|nosw|mouse").split("|") as [Snapshot, string, string, string];
  const install = useCallback(async () => {
    const ev = window.__axInstall;
    if (!ev) return;
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === "accepted") window.__axInstall = null;
    window.dispatchEvent(new Event("ax:installable"));
  }, []);
  if (state === "none" && touch !== "touch") return null;
  return (
    <div className="mt-3 border-t border-hairline pt-3">
      {state === "none" && (
        <p className="px-3 text-[13px] text-ivory-3">
          {secure === "http"
            ? "This browser will not install from an http:// address. Open https://aeronexus-app.vercel.app to install."
            : worker === "nosw"
              ? "Preparing the offline copy; the install offer appears once it is ready. Reload in a few seconds."
              : "This browser has not offered an install yet. Chrome and Samsung Internet: menu → Install app or Add to Home screen."}
        </p>
      )}
      {state === "standalone" && <p className="px-3 text-[13px] text-ivory-3">Installed on this device. The demo day works offline.</p>}
      {state === "prompt" && (
        <div className="flex items-center justify-between gap-3 px-3">
          <p className="text-[13px] text-ivory-2">Keep AeroNexus on the home screen; the demo day works offline.</p>
          <Button size="sm" onClick={install}>Install app</Button>
        </div>
      )}
      {state === "ios" && <p className="px-3 text-[13px] text-ivory-2">To install on iPhone or iPad: tap Share, then <span className="text-ivory">Add to Home Screen</span>.</p>}
    </div>
  );
}
