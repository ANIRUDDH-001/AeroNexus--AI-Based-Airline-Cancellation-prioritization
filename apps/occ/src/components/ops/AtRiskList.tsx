"use client";
import { useState } from "react";
import type { Timeline, TimelineFlight } from "@/lib/api";
import { hhmm } from "@/lib/format";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/** At risk now (spec §5.5): eight rows, the reason in words, click selects the strip on the board. */
export function AtRiskList({ timeline, flights, airport, filter, selectedId, onSelect }: { timeline: Timeline; flights: Map<string, TimelineFlight>; airport: string | null; filter: string | null; selectedId: string | null; onSelect: (id: string) => void }) {
  const [all, setAll] = useState(false);
  let rows = timeline.at_risk.map((r) => ({ r, f: flights.get(r.flight) }));
  if (airport) rows = rows.filter(({ f }) => f && (f.origin === airport || f.dest === airport));
  if (filter === "forced_cancellations") rows = rows.filter(({ r }) => r.forced);
  if (filter === "delayed_flights") rows = rows.filter(({ r }) => r.delay_min > 0);
  rows.sort((a, b) => Number(b.r.forced) - Number(a.r.forced) || (a.f?.std ?? 0) - (b.f?.std ?? 0));
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <Panel title={`At risk now (${rows.length})`} aside={rows.length > 8 && <button type="button" onClick={() => setAll(!all)} className="underline underline-offset-[3px] hover:text-ivory">{all ? "show fewer" : `show all ${rows.length}`}</button>} bodyClassName="p-0">
      {rows.length === 0 ? (
        <p className="px-3.5 py-3 text-[13px] text-ivory-2">Nothing at risk at {timeline.clock_hhmm}{airport ? ` at ${airport}` : ""}.</p>
      ) : (
        <ul className="max-h-[360px] overflow-y-auto">
          {shown.map(({ r, f }) => (
            <li key={r.flight}>
              <button type="button" onClick={() => onSelect(r.flight)} className={cn("grid w-full grid-cols-[76px_1fr] gap-x-2 gap-y-0.5 px-3.5 py-1.5 text-left text-[12.5px] hover:bg-ivory-soft", selectedId === r.flight && "bg-ivory-soft")}>
                <span className="mono text-ivory">{f?.number ?? r.flight}</span>
                <span className="text-ivory-2">
                  {f ? `${f.origin}–${f.dest} ` : ""}
                  <span className="mono">{f ? hhmm(f.std) : ""}</span>
                </span>
                <span className={cn("col-span-2 text-[12px] leading-snug", r.forced ? "text-coral" : "text-amber")}>{(r.reasons[0] ?? "").replace(/^cannot operate: /, "")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
