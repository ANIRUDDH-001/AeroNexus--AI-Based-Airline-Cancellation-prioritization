"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PARAM_VIEW, PHONE_VIEWS, parseView, withParams } from "@/lib/url";

/** On phones, a horizontal swipe on the operations page moves between Today / Board / Map / Plans
 *  (spec Phase 5). Pointer events only; a swipe that starts on a horizontally scrollable element
 *  (the board canvas, a wide table) is left to that element. */
export function useSwipeViews(enabled: boolean) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!enabled) return;
    let startX = 0;
    let startY = 0;
    let active = false;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-hscroll], .scroll-thin, input, textarea, [role=slider], [role=dialog]")) return;
      startX = e.clientX;
      startY = e.clientY;
      active = true;
    };
    const up = (e: PointerEvent) => {
      if (!active) return;
      active = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      const i = PHONE_VIEWS.indexOf(parseView(params.get(PARAM_VIEW)));
      const next = PHONE_VIEWS[Math.min(PHONE_VIEWS.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1)))];
      if (next === PHONE_VIEWS[i]) return;
      router.replace(`${pathname}${withParams(window.location.search, { [PARAM_VIEW]: next === "today" ? null : next })}`, { scroll: false });
    };
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, [enabled, params, router, pathname]);
}
