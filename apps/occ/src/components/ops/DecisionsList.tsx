"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, needsWriteKey, type Timeline } from "@/lib/api";
import { keys } from "@/lib/query";
import { hhmm } from "@/lib/format";
import { useEngine } from "@/hooks/useEngine";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Pill } from "@/components/ui/pill";
import { disruptionName } from "@/components/disruptions/describe";
import { cn } from "@/lib/utils";

/** Today's decisions (spec §5.7): the day's runs and decisions as a trail, with the disruptions by start time,
 *  the committed chips, and "Reset the day". */
export function DecisionsList({ dayId, timeline, clock, onOpenRun, onChanged }: { dayId: string; timeline: Timeline; clock: number; onOpenRun: (runId: string, t: number) => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { demo } = useEngine();
  const [confirm, setConfirm] = useState(false);
  const runs = useQuery({ queryKey: keys.runs(dayId), queryFn: () => api.runs(dayId), staleTime: 15_000 });
  const reset = useMutation({
    mutationFn: () => api.resetCommitted(dayId),
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast("The day is reset; committed decisions cleared");
      onChanged();
    },
    onError: (e) => toast.error(needsWriteKey(e) ? "Resetting needs the write key" : e instanceof Error ? e.message : "Could not reset the day"),
  });
  const rows = (runs.data?.data ?? []).slice().sort((a, b) => a.decision_time - b.decision_time || a.created_at.localeCompare(b.created_at));
  const events: { t: number; text: string; tone: "mint" | "neutral" | "lilac" | "amber"; runId?: string }[] = [
    ...timeline.disruptions.map((d) => ({ t: d.start, text: `${disruptionName(d.type)} at ${d.target}`, tone: "lilac" as const })),
    ...rows.map((r) => ({
      t: r.decision_time,
      text: r.accepted_plan != null ? `plan ${r.accepted_plan} accepted` : r.override_reason ? `override: ${r.override_reason}` : `recommendation, no decision`,
      tone: r.accepted_plan != null ? ("mint" as const) : r.override_reason ? ("amber" as const) : ("neutral" as const),
      runId: r.id,
    })),
  ].sort((a, b) => a.t - b.t);
  return (
    <Panel title="Today's decisions" aside={timeline.committed.count > 0 && !demo && <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Reset the day</Button>} bodyClassName="p-0">
      {events.length === 0 ? (
        <p className="px-3.5 py-3 text-[13px] text-ivory-2">No decisions yet today.</p>
      ) : (
        <ol className="max-h-[300px] overflow-y-auto py-1">
          {events.map((e, i) => (
            <li key={i}>
              <button type="button" disabled={!e.runId} onClick={() => e.runId && onOpenRun(e.runId, e.t)} className={cn("flex w-full items-center gap-3 px-3.5 py-1.5 text-left text-[12.5px]", e.runId && "hover:bg-ivory-soft", e.t === clock && "bg-ivory-soft/60")}>
                <span className="mono w-[42px] shrink-0 text-ivory-2">{hhmm(e.t)}</span>
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", e.tone === "mint" ? "bg-mint" : e.tone === "lilac" ? "bg-lilac" : e.tone === "amber" ? "bg-amber" : "bg-ivory-3")} />
                <span className={cn("truncate", e.tone === "neutral" ? "text-ivory-2" : "text-ivory")}>{e.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {timeline.committed.count > 0 && (
        <div className="border-t border-hairline px-3.5 py-2.5">
          <div className="mb-1.5 text-[12px] text-ivory-2">Committed today ({timeline.committed.count})</div>
          <div className="flex flex-wrap gap-1.5">
            {timeline.committed.labels.map((l) => (
              <Pill key={l} tone="mint">
                {l}
              </Pill>
            ))}
          </div>
        </div>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Reset the day?"
        description="Every accepted plan is removed from the day and it replays as originally scheduled. Runs keep their record."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep the decisions
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                reset.mutate();
                setConfirm(false);
              }}
            >
              Reset the day
            </Button>
          </>
        }
      />
    </Panel>
  );
}
