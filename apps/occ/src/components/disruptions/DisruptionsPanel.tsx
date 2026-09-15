"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, needsWriteKey, type Disruption, type Timeline } from "@/lib/api";
import { hhmm } from "@/lib/format";
import { useEngine } from "@/hooks/useEngine";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Dialog, Tooltip } from "@/components/ui/overlay";
import { describeDisruption, disruptionName } from "./describe";
import { DisruptionSheet } from "./DisruptionSheet";

/** Active disruptions as chips, with a definition on hover and a remove control; "Add disruption" opens the
 *  sheet (spec §5.4). Writes are disabled with a reason while the engine is unavailable. */
export function DisruptionsPanel({ timeline, dayId, airportNames, onChanged, sheetOpen, onSheetOpenChange }: { timeline: Timeline; dayId: string; airportNames: Map<string, string>; onChanged: () => void; sheetOpen: boolean; onSheetOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { demo } = useEngine();
  const [confirm, setConfirm] = useState<Disruption | null>(null);
  const remove = useMutation({
    mutationFn: (d: Disruption) => api.removeDisruption(dayId, d.id),
    onSuccess: async () => {
      toast("Disruption removed");
      await qc.invalidateQueries();
      onChanged();
    },
    onError: (e) => toast.error(needsWriteKey(e) ? "Editing needs the write key" : e instanceof Error ? e.message : "Could not remove the disruption"),
  });
  return (
    <Panel
      title="Disruptions"
      aside={
        <Tooltip content={demo ? "Unavailable while the engine is asleep; wake it to change the day." : "Add fog, a capacity cut, an aircraft on ground, a crew shortage or a known delay."}>
          <span>
            <Button size="sm" variant="outline" onClick={() => onSheetOpenChange(true)} disabled={demo}>
              Add disruption
            </Button>
          </span>
        </Tooltip>
      }
    >
      {timeline.disruptions.length === 0 ? (
        <p className="text-[13px] text-ivory-2">No disruptions on this day. Add one to see the engine work.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {timeline.disruptions.map((d) => (
            <li key={d.id}>
              <Tooltip content={describeDisruption(d, airportNames)}>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-lilac/40 bg-lilac-soft px-2.5 py-1 text-[12px]">
                  <span className="font-medium text-lilac">{disruptionName(d.type)}</span>
                  <span className="text-ivory">{d.target}</span>
                  <span className="mono text-ivory-2">
                    {hhmm(d.start)}–{d.end_nominal == null ? "rest of day" : `${hhmm(d.end_nominal)}${d.end_distribution ? " ±" : ""}`}
                  </span>
                  {!demo && (
                    <button type="button" onClick={() => setConfirm(d)} className="ml-0.5 rounded-full p-0.5 text-ivory-3 hover:text-coral" aria-label={`Remove ${disruptionName(d.type)} at ${d.target}`}>
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Remove this disruption?"
        description={confirm ? `${describeDisruption(confirm, airportNames)}. The day is re-propagated without it.` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm) remove.mutate(confirm);
                setConfirm(null);
              }}
            >
              Remove
            </Button>
          </>
        }
      />
      <DisruptionSheet open={sheetOpen} onOpenChange={onSheetOpenChange} dayId={dayId} timeline={timeline} airportNames={airportNames} onChanged={onChanged} />
    </Panel>
  );
}
