"use client";
import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, type InstanceRow } from "@/lib/api";
import { keys } from "@/lib/query";
import { pickDefaultDay } from "@/lib/day";
import { DEFAULT_CLOCK, PARAM_CLOCK, PARAM_DAY, PARAM_RUN, parseClock, withParams } from "@/lib/url";

const LS_DAY = "ax.day";
const LS_CLOCK = "ax.clock";

function remember(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The operational day and decision time the console is looking at. Both live in the URL (?day=&t=) so every
 *  screen is linkable; localStorage only supplies defaults when the URL has none. Must be rendered under a
 *  Suspense boundary (useSearchParams). */
export function useDay() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const instances = useQuery({ queryKey: keys.instances, queryFn: () => api.instances(), staleTime: 60_000 });
  const rows: InstanceRow[] = useMemo(() => instances.data?.data ?? [], [instances.data]);

  const urlDay = params.get(PARAM_DAY);
  const urlClock = params.get(PARAM_CLOCK);
  const dayId = urlDay ?? recall(LS_DAY);
  const day = useMemo(() => (dayId ? rows.find((r) => r.id === dayId) ?? null : null), [rows, dayId]);
  const clock = parseClock(urlClock ?? recall(LS_CLOCK) ?? undefined, DEFAULT_CLOCK);

  // merge into the URL as it is *now*, not the snapshot this render saw: two quick navigations (a tab link and
  // an effect writing the run id) must not clobber each other
  const replace = useCallback(
    (next: Record<string, string | number | null>) => {
      const current = typeof window !== "undefined" ? window.location.search : params.toString();
      router.replace(`${pathname}${withParams(current, next)}`, { scroll: false });
    },
    [router, pathname, params],
  );

  // once the day list is known: fall back to the demo day when the remembered one is gone, and put the
  // resolved state into the URL so the link is complete
  useEffect(() => {
    if (!instances.isSuccess) return;
    const resolved = (dayId && rows.find((r) => r.id === dayId)) || pickDefaultDay(rows);
    const next: Record<string, string | number | null> = {};
    if (resolved && resolved.id !== urlDay) next[PARAM_DAY] = resolved.id;
    if (urlClock == null) next[PARAM_CLOCK] = clock;
    if (Object.keys(next).length) replace(next);
    if (resolved) remember(LS_DAY, resolved.id);
  }, [instances.isSuccess, rows, dayId, urlDay, urlClock, clock, replace]);

  const setDay = useCallback(
    (id: string | null) => {
      remember(LS_DAY, id);
      replace({ [PARAM_DAY]: id, [PARAM_RUN]: null });
    },
    [replace],
  );
  const setClock = useCallback(
    (minutes: number) => {
      const t = parseClock(String(minutes));
      remember(LS_CLOCK, String(t));
      replace({ [PARAM_CLOCK]: t, [PARAM_RUN]: null });
    },
    [replace],
  );

  return {
    day,
    dayId: day?.id ?? null,
    days: rows,
    daysLoading: instances.isPending,
    daysOrigin: instances.data?.origin ?? null,
    clock,
    setDay,
    setClock,
    refreshDays: () => instances.refetch(),
  };
}
