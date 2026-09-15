"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, pingLive, staticBundle, staticMode, type Health, type StaticIndex } from "@/lib/api";
import { keys } from "@/lib/query";

export type EngineState = "connecting" | "online" | "starting" | "unavailable" | "error";

const subscribe = (l: () => void) => staticMode.subscribe(() => l());
const getSnapshot = () => staticMode.active;

/** Whether the console is currently answered by the precomputed bundle instead of the engine. */
function useDemoMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Engine status for the top bar (spec §4). Four user-facing states: online, starting (we are waking it),
 *  unavailable (asleep or unreachable; the demo bundle answers reads), error (it answered with an error).
 *  While unavailable the health query polls every 15 s; when the engine comes back, every query is refetched
 *  so the screen switches from demo to live without a reload. */
type Engine = {
  state: EngineState;
  health: Health | null;
  demo: boolean;
  bundle: StaticIndex | null;
  waking: { since: number } | null;
  wakingSeconds: number;
  wake: () => Promise<void>;
  error: string | null;
};

const EngineCtx = createContext<Engine | null>(null);

/** One observer for the whole console: mount this once in the providers; read it with useEngine(). */
export function EngineProvider({ children }: { children: ReactNode }) {
  const engine = useEngineState();
  return <EngineCtx.Provider value={engine}>{children}</EngineCtx.Provider>;
}

export function useEngine(): Engine {
  const e = useContext(EngineCtx);
  if (!e) throw new Error("useEngine outside EngineProvider");
  return e;
}

function useEngineState(): Engine {
  const qc = useQueryClient();
  const demo = useDemoMode();
  const [waking, setWaking] = useState<{ since: number } | null>(null);
  const [wakingSeconds, setWakingSeconds] = useState(0);
  const wasUp = useRef<boolean | null>(null);

  // a ticking counter while we wait for the engine, so the banner can say how long it has been
  useEffect(() => {
    if (!waking) return;
    const since = waking.since;
    const id = setInterval(() => setWakingSeconds(Math.round((Date.now() - since) / 1000)), 1000);
    return () => {
      clearInterval(id);
      setWakingSeconds(0);
    };
  }, [waking]);

  const health = useQuery({
    queryKey: keys.health,
    queryFn: () => api.health(),
    refetchInterval: (q) => (q.state.data?.origin === "live" && !q.state.error ? 60_000 : 15_000),
    staleTime: 10_000,
    retry: false,
  });
  const bundle = useQuery({ queryKey: keys.bundle, queryFn: () => staticBundle(), staleTime: Infinity });

  const h: Health | null = health.data?.data ?? null;
  const live = !!health.data && health.data.origin === "live" && !health.error;
  let state: EngineState = "connecting";
  if (health.isPending) state = "connecting";
  else if (health.error) state = "error";
  else if (live) state = "online";
  else if (waking) state = "starting";
  else state = "unavailable";

  // came back: drop the demo flag and refetch everything so results are live again
  useEffect(() => {
    if (live && wasUp.current === false) {
      setWaking(null);
      staticMode.set(false);
      void qc.invalidateQueries();
    }
    wasUp.current = live;
  }, [live, qc]);

  const wake = useCallback(async () => {
    if (waking) return;
    setWaking({ since: Date.now() });
    for (let i = 0; i < 12; i++) {
      if (await pingLive()) {
        await qc.invalidateQueries();
        setWaking(null);
        return;
      }
      await new Promise((r) => setTimeout(r, 8000));
    }
    setWaking(null);
  }, [waking, qc]);

  return {
    state,
    health: h,
    demo: demo || state === "unavailable" || state === "starting",
    bundle: (bundle.data ?? null) as StaticIndex | null,
    waking,
    wakingSeconds,
    wake,
    error: health.error instanceof Error ? health.error.message : null,
  };
}
