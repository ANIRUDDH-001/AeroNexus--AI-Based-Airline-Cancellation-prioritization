"use client";
import { useQuery } from "@tanstack/react-query";
import { api, type Action } from "@/lib/api";
import { keys } from "@/lib/query";
import { useDay } from "./useDay";

/** The day if nobody acts, at the selected decision time. */
export function useTimeline() {
  const { dayId, clock } = useDay();
  const q = useQuery({
    queryKey: keys.timeline(dayId ?? "", clock),
    queryFn: () => api.timeline(dayId!, clock),
    enabled: !!dayId,
  });
  return { timeline: q.data?.data ?? null, origin: q.data?.origin ?? null, loading: q.isPending && !!dayId, error: q.error instanceof Error ? q.error.message : null, refetch: q.refetch, dayId, clock };
}

/** The day after `actions` are applied at the decision time (the board's after view). */
export function usePlanTimeline(actions: Action[] | null) {
  const { dayId, clock } = useDay();
  const q = useQuery({
    queryKey: keys.planTimeline(dayId ?? "", clock, actions ?? []),
    queryFn: () => api.planTimeline({ instance_id: dayId!, decision_time: clock, actions: actions! }),
    enabled: !!dayId && !!actions && actions.length > 0,
  });
  return { timeline: q.data?.data ?? null, origin: q.data?.origin ?? null, loading: q.isPending && !!actions?.length, error: q.error instanceof Error ? q.error.message : null };
}
