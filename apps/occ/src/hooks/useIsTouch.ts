"use client";
import { useSyncExternalStore } from "react";

const query = "(pointer: coarse)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(query);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** True on touch-first devices: definitions open on tap, rows grow to 36 px, hover cards become sheets. */
export function useIsTouch(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

const phoneQuery = "(max-width: 767px)";
const subscribePhone = (cb: () => void) => {
  const m = window.matchMedia(phoneQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** Below the md breakpoint: the operations page shows one view at a time and the tab bar takes over. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false);
}
