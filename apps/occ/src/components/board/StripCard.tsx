"use client";
import Link from "next/link";
import type { TimelineFlight } from "@/lib/api";
import { stripState, type FlightChange } from "@/lib/diff";
import { GLOSSARY } from "@/lib/glossary";
import { fmt, hhmm } from "@/lib/format";
import { Pill } from "@/components/ui/pill";
import { useNavHref } from "@/components/shell/TopBar";

const STATE_TONE = { on_time: "mint", delayed: "amber", at_risk: "amber", cancels_itself: "coral", cancelled_by_plan: "neutral", already_happened: "neutral", protected: "mint" } as const;

/** Everything about one leg, in words: the hover card on desktop, the bottom sheet on touch. */
export function StripCard({ flight, change, committed }: { flight: TimelineFlight; change: FlightChange | null; committed: boolean }) {
  const state = change?.kind === "protected" ? "protected" : stripState(flight);
  const t = GLOSSARY[`state_${state}` as keyof typeof GLOSSARY];
  const withState = useNavHref();
  const planned = `${flight.std_hhmm}–${flight.sta_hhmm}`;
  const actual = flight.dep != null && flight.arr != null ? `${hhmm(flight.dep)}–${hhmm(flight.arr)}` : null;
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mono text-[14px] font-semibold text-ivory">{flight.number}</div>
          <div className="text-[12.5px] text-ivory-2">
            {flight.origin} to {flight.dest}, {flight.aircraft_type}, {flight.tail ?? "no tail"}
          </div>
        </div>
        <Pill tone={STATE_TONE[state]}>{t.label}</Pill>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12.5px]">
        <dt className="text-ivory-3">Planned</dt>
        <dd className="mono">{planned}</dd>
        {actual && actual !== planned && (
          <>
            <dt className="text-ivory-3">Propagated</dt>
            <dd className="mono">
              {actual} <span className="text-amber">+{flight.delay_min} min</span>
            </dd>
          </>
        )}
        <dt className="text-ivory-3">Passengers</dt>
        <dd>
          {fmt(flight.booked_pax)} booked, {fmt(flight.pax_connecting)} connecting
        </dd>
        {flight.crew_id && (
          <>
            <dt className="text-ivory-3">Crew</dt>
            <dd className="mono">{flight.crew_id}{flight.standby_called ? " (standby called)" : ""}</dd>
          </>
        )}
      </dl>
      <p className="text-[12.5px] leading-snug text-ivory-2">{t.short}</p>
      {flight.reason && <p className="text-[12.5px] leading-snug text-coral">{flight.reason}</p>}
      {(flight.risk_reasons ?? []).length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] text-amber">
          {(flight.risk_reasons ?? []).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {change && change.kind !== "protected" && <p className="text-[12.5px] text-ivory">Under this plan: {change.label}.</p>}
      {committed && <p className="text-[12.5px] text-ivory-2">{GLOSSARY.state_committed.short}</p>}
      <div className="pt-1 text-[12.5px]">
        <Link href={withState(`/flights`) + `&q=${encodeURIComponent(flight.number)}`}>Open in Flights</Link>
      </div>
    </div>
  );
}
