"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, needsWriteKey, type Timeline } from "@/lib/api";
import { keys } from "@/lib/query";
import { hhmm } from "@/lib/format";
import { useDay } from "@/hooks/useDay";
import { Sheet } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Slider, Switch } from "@/components/ui/controls";
import { DISRUPTION_TYPES, disruptionName, targetKind, toSpec, type DisruptionType } from "./describe";

type Impact = { affected: number; newlyAtRisk: number; moreForced: number; disruptionId: string | null };

/** Add a disruption in words, see its real impact right after, undo in one click (spec §5.4). The engine has no
 *  dry-run propagation, so the impact is the re-fetched timeline compared with the one before. */
export function DisruptionSheet(props: { open: boolean; onOpenChange: (o: boolean) => void; dayId: string; timeline: Timeline; airportNames: Map<string, string>; onChanged: () => void }) {
  return props.open ? <DisruptionForm {...props} /> : null;
}

function DisruptionForm({ open, onOpenChange, dayId, timeline, airportNames, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; dayId: string; timeline: Timeline; airportNames: Map<string, string>; onChanged: () => void }) {
  const qc = useQueryClient();
  const { clock } = useDay();
  const [type, setTypeState] = useState<DisruptionType>("LVP");
  const [target, setTarget] = useState("");
  const [start, setStart] = useState(clock);
  const [end, setEnd] = useState<number>(clock + 240);
  const [openEnd, setOpenEnd] = useState(false);
  const [capacity, setCapacity] = useState(0.5);
  const [rate, setRate] = useState(20);
  const [crews, setCrews] = useState(3);
  const [delay, setDelay] = useState(60);
  const [autoRun, setAutoRun] = useState(true);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [flightQuery, setFlightQuery] = useState("");

  const kind = targetKind(type);
  const airports = useQuery({ queryKey: keys.table(dayId, "airports"), queryFn: () => api.table(dayId, "airports"), enabled: open && kind === "airport", staleTime: 5 * 60_000 });
  const airportOptions = useMemo(() => (airports.data?.data.rows ?? []).map((r) => ({ value: String(r.code), label: `${r.code} ${String(r.name ?? "")}` })), [airports.data]);
  const tailOptions = useMemo(() => Object.keys(timeline.rotations).sort().map((t) => ({ value: t, label: t })), [timeline.rotations]);
  const flightOptions = useMemo(() => {
    const q = flightQuery.trim().toLowerCase().replace(/\s/g, "");
    return timeline.flights
      .filter((f) => f.status !== "PAST" && (!q || f.number.toLowerCase().replace(/\s/g, "").includes(q)))
      .slice(0, 40)
      .map((f) => ({ value: f.id, label: `${f.number} ${f.origin}–${f.dest} ${f.std_hhmm}` }));
  }, [timeline.flights, flightQuery]);

  const setType = (t: DisruptionType) => {
    setTypeState(t);
    setTarget("");
  };

  const preview = useMemo(() => {
    if (!target) return "Choose a target to see the sentence.";
    const where = kind === "airport" ? `at ${airportNames.get(target) ?? target}` : target;
    const sev = type === "LVP" || type === "AIRPORT_CAPACITY" ? `${Math.round(capacity * 100)}% of normal capacity` : type === "ATC_FLOW" ? `${rate} movements per hour` : type === "CREW_UNAVAILABLE" ? `${crews} crews short` : type === "FLIGHT_DELAY" ? `${delay} min` : "";
    const when = type === "FLIGHT_DELAY" ? "" : type === "CREW_UNAVAILABLE" ? ` from ${hhmm(start)}` : ` from ${hhmm(start)} to ${openEnd ? "the rest of the day" : `${type === "LVP" ? "about " : ""}${hhmm(end)}`}${type === "LVP" ? " (end time uncertain)" : ""}`;
    return `${disruptionName(type)} ${where}${when}${sev ? `: ${sev}` : ""}.`;
  }, [type, target, kind, airportNames, capacity, rate, crews, delay, start, end, openEnd]);

  const add = useMutation({
    mutationFn: async () => {
      const spec = toSpec({ type, target, start, end: openEnd ? null : end, capacity, rate, crews, delay });
      const before = timeline;
      await api.addDisruption(dayId, spec);
      await qc.invalidateQueries({ queryKey: keys.timeline(dayId, clock) });
      await qc.invalidateQueries({ queryKey: keys.instances });
      const after = (await qc.fetchQuery({ queryKey: keys.timeline(dayId, clock), queryFn: () => api.timeline(dayId, clock) })).data;
      const beforeRisk = new Set(before.flights.filter((f) => f.at_risk || f.status === "CANCELLED_FORCED").map((f) => f.id));
      const affected = after.flights.filter((f) => {
        const b = before.flights.find((x) => x.id === f.id);
        return b && (b.status !== f.status || b.delay_min !== f.delay_min || b.at_risk !== f.at_risk);
      }).length;
      const newlyAtRisk = after.flights.filter((f) => (f.at_risk || f.status === "CANCELLED_FORCED") && !beforeRisk.has(f.id)).length;
      const added = after.disruptions.find((d) => !before.disruptions.some((x) => x.id === d.id));
      return { affected, newlyAtRisk, moreForced: after.summary.forced_cancellations - before.summary.forced_cancellations, disruptionId: added?.id ?? null } satisfies Impact;
    },
    onSuccess: (im) => {
      setImpact(im);
      onChanged();
      if (autoRun) window.dispatchEvent(new CustomEvent("aeronexus:recommend"));
    },
    onError: (e) => toast.error(needsWriteKey(e) ? "Editing needs the write key" : e instanceof Error ? e.message : "Could not add the disruption"),
  });
  const undo = useMutation({
    mutationFn: async () => {
      if (impact?.disruptionId) await api.removeDisruption(dayId, impact.disruptionId);
      await qc.invalidateQueries();
    },
    onSuccess: () => {
      setImpact(null);
      toast("Disruption removed");
      onChanged();
    },
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add a disruption"
      description="Say what happened in words; the day is re-propagated and the impact appears here."
      footer={
        impact ? (
          <>
            <Button variant="ghost" onClick={() => undo.mutate()} disabled={undo.isPending}>
              Undo
            </Button>
            <Button variant="primary" className="ml-auto" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Switch checked={autoRun} onChange={setAutoRun} label={<span className="text-[12.5px] text-ivory-2">Ask for a plan after changes</span>} />
            <Button variant="primary" className="ml-auto" onClick={() => add.mutate()} disabled={!target || add.isPending}>
              {add.isPending ? "Re-propagating…" : "Add and re-propagate"}
            </Button>
          </>
        )
      }
    >
      {impact ? (
        <div className="space-y-3">
          <p className="text-[14px] text-ivory">{preview}</p>
          <div className="rounded-panel border border-hairline bg-well p-3">
            <div className="text-[12px] text-ivory-2">Impact if nobody acts</div>
            <ul className="mt-1 space-y-0.5 text-[13.5px]">
              <li>
                <span className="num font-semibold">{impact.affected}</span> flights affected
              </li>
              <li>
                <span className="num font-semibold text-amber">{impact.newlyAtRisk}</span> newly at risk
              </li>
              <li>
                <span className="num font-semibold text-coral">{impact.moreForced >= 0 ? `+${impact.moreForced}` : impact.moreForced}</span> more cancel themselves
              </li>
            </ul>
          </div>
          <p className="text-[12.5px] text-ivory-2">{autoRun ? "A recommendation is being requested for this decision time." : "Ask for a recommendation from the plans section when ready."}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="What happened">
            <Select<DisruptionType> value={type} onChange={setType} options={DISRUPTION_TYPES.map((t) => ({ value: t.value, label: t.label }))} ariaLabel="Disruption type" className="w-full" />
          </Field>
          {kind === "airport" && (
            <Field label="Airport">
              <Select value={target} onChange={setTarget} options={airportOptions} placeholder={airports.isPending ? "Loading airports…" : "Choose an airport"} ariaLabel="Airport" className="w-full" />
            </Field>
          )}
          {kind === "tail" && (
            <Field label="Aircraft">
              <Select value={target} onChange={setTarget} options={tailOptions} placeholder="Choose a tail" ariaLabel="Aircraft" className="w-full" />
            </Field>
          )}
          {kind === "flight" && (
            <Field label="Flight" hint="Flights that have not departed yet.">
              <Input value={flightQuery} onChange={(e) => setFlightQuery(e.target.value)} placeholder="Type a flight number" aria-label="Flight search" className="mb-1.5" />
              <Select value={target} onChange={setTarget} options={flightOptions} placeholder="Choose a flight" ariaLabel="Flight" className="w-full" />
            </Field>
          )}
          {type !== "FLIGHT_DELAY" && (
            <Field label={`Starts at ${hhmm(start)}`}>
              <Slider value={start} onChange={setStart} min={0} max={1425} step={15} ariaLabel="Start time" />
            </Field>
          )}
          {(type === "LVP" || type === "AIRPORT_CAPACITY" || type === "ATC_FLOW" || type === "CLOSURE" || type === "AOG") && (
            <Field label={openEnd ? "Ends: rest of the day" : `Ends at ${type === "LVP" ? "about " : ""}${hhmm(end)}`} hint={type === "LVP" ? "Fog lifts when it lifts: the engine samples the end time around this value." : undefined}>
              {!openEnd && <Slider value={end} onChange={(v) => setEnd(Math.max(start + 15, v))} min={0} max={1620} step={15} ariaLabel="End time" />}
              {type === "AOG" && <Switch checked={openEnd} onChange={setOpenEnd} label={<span className="text-[12.5px] text-ivory-2">Grounded for the rest of the day</span>} className="mt-1" />}
            </Field>
          )}
          {(type === "LVP" || type === "AIRPORT_CAPACITY") && (
            <Field label={`Capacity: ${Math.round(capacity * 100)}% of normal`}>
              <Slider value={capacity} onChange={setCapacity} min={0.1} max={0.9} step={0.05} ariaLabel="Capacity" />
            </Field>
          )}
          {type === "ATC_FLOW" && (
            <Field label={`Flow: ${rate} movements per hour`}>
              <Slider value={rate} onChange={setRate} min={4} max={40} step={2} ariaLabel="Movements per hour" />
            </Field>
          )}
          {type === "CREW_UNAVAILABLE" && (
            <Field label={`${crews} crews unavailable`}>
              <Slider value={crews} onChange={setCrews} min={1} max={12} step={1} ariaLabel="Crews" />
            </Field>
          )}
          {type === "FLIGHT_DELAY" && (
            <Field label={`Known delay: ${delay} min`}>
              <Slider value={delay} onChange={setDelay} min={15} max={300} step={15} ariaLabel="Delay minutes" />
            </Field>
          )}
          <div className="rounded-panel border border-hairline bg-well p-3 text-[13.5px] leading-snug text-ivory">{preview}</div>
        </div>
      )}
    </Sheet>
  );
}
