import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type InstanceRow } from "./api";

/** Workspace context: which operational day is open and at what decision time (minutes from 00:00).
 *  Persisted per browser as a convenience; the API is the source of truth. */
type Store = {
  instances: InstanceRow[];
  instanceId: string | null;
  instance: InstanceRow | null;
  clock: number;
  setInstanceId: (id: string | null) => void;
  setClock: (m: number) => void;
  refreshInstances: () => Promise<void>;
  lastRunId: string | null;
  setLastRunId: (id: string | null) => void;
};

const Ctx = createContext<Store | null>(null);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [instanceId, setInstanceIdState] = useState<string | null>(read("ax.instance"));
  const [clock, setClockState] = useState<number>(Number(read("ax.clock") ?? 300));
  const [lastRunId, setLastRunIdState] = useState<string | null>(read("ax.run"));

  const refreshInstances = useCallback(async () => {
    const rows = await api.instances();
    setInstances(rows);
    setInstanceIdState((cur) => {
      const next = cur && rows.some((r) => r.id === cur) ? cur : rows[0]?.id ?? null;
      write("ax.instance", next);
      return next;
    });
  }, []);

  useEffect(() => {
    void refreshInstances().catch(() => setInstances([]));
  }, [refreshInstances]);

  const value = useMemo<Store>(
    () => ({
      instances,
      instanceId,
      instance: instances.find((r) => r.id === instanceId) ?? null,
      clock,
      setInstanceId: (id) => {
        setInstanceIdState(id);
        write("ax.instance", id);
        setLastRunIdState(null);
        write("ax.run", null);
      },
      setClock: (m) => {
        setClockState(m);
        write("ax.clock", String(m));
      },
      refreshInstances,
      lastRunId,
      setLastRunId: (id) => {
        setLastRunIdState(id);
        write("ax.run", id);
      },
    }),
    [instances, instanceId, clock, refreshInstances, lastRunId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
