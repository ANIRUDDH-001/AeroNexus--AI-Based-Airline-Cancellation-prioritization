import { QueryClient } from "@tanstack/react-query";
import type { Action } from "./api";

/** One QueryClient for the console. Timelines go stale after 30 s, configuration and tables after 5 min;
 *  nothing refetches on window focus because a duty manager's screen must not change under their eyes. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => count < 1 && !(err instanceof Error && "status" in err),
      },
    },
  });
}

/** A short stable key for a list of actions, so two identical plans share one cached after-view. */
function actionsKey(actions: Action[]): string {
  return actions.map((a) => `${a.type}:${[...(a.target_flights ?? [])].sort().join(",")}:${JSON.stringify(a.params ?? {})}`).join("|");
}

export const keys = {
  health: ["health"] as const,
  bundle: ["bundle"] as const,
  instances: ["instances"] as const,
  timeline: (day: string, t: number) => ["timeline", day, t] as const,
  planTimeline: (day: string, t: number, actions: Action[]) => ["planTimeline", day, t, actionsKey(actions)] as const,
  run: (id: string) => ["run", id] as const,
  runs: (day?: string) => ["runs", day ?? "*"] as const,
  config: ["config"] as const,
  metrics: ["metrics"] as const,
  table: (day: string, entity: string) => ["table", day, entity] as const,
  committed: (day: string) => ["committed", day] as const,
  cases: ["cases"] as const,
  benchmark: ["benchmark"] as const,
};
