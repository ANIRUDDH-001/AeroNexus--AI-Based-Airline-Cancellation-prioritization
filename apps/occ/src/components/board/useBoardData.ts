import { useMemo } from "react";
import type { Disruption, Timeline, TimelineFlight } from "@/lib/api";
import { stripState, type Diff } from "@/lib/diff";

/** Board layout data, computed once per timeline (spec §10.2): rows sorted by risk, legs per row, the time
 *  window, and the text each strip can afford at its width. */

export type Window = "day" | "12h" | "6h";
export type BoardView = "before" | "after" | "changes";

export const DAY_START = 0;
export const DAY_END = 27 * 60; // late arrivals spill past midnight

export type Row = { tail: string; legs: TimelineFlight[]; atRisk: number; forced: number; aog: boolean; touched: boolean };

export function windowRange(w: Window, clock: number): [number, number] {
  if (w === "day") return [DAY_START, DAY_END];
  const span = w === "12h" ? 720 : 360;
  let start = clock - span / 3; // a third before the decision time, two thirds after
  start = Math.max(DAY_START, Math.min(start, DAY_END - span));
  return [Math.round(start / 15) * 15, Math.round(start / 15) * 15 + span];
}

/** Text a strip can afford: full route, number only, digits only, or nothing (the popover has it all). */
export function stripText(f: TimelineFlight, widthPx: number): string {
  if (widthPx >= 120) return `${f.number} ${f.origin}–${f.dest}`;
  if (widthPx >= 62) return f.number;
  if (widthPx >= 40) return f.number.replace(/^[0-9A-Z]{2}\s?/, ""); // drop the airline code ("6E2018" -> "2018")
  return "";
}

export function useBoardData(timeline: Timeline | null, after: Timeline | null, diff: Diff | null, opts: { query: string; onlyAtRisk: boolean; view: BoardView; airport: string | null }) {
  return useMemo(() => {
    const source = opts.view === "before" || !after ? timeline : after;
    if (!source) return { rows: [] as Row[], byId: new Map<string, TimelineFlight>(), disruptions: [] as Disruption[] };
    const byId = new Map(source.flights.map((f) => [f.id, f]));
    const byTail = new Map<string, TimelineFlight[]>();
    for (const f of source.flights) {
      const tail = f.tail ?? "unassigned";
      if (!byTail.has(tail)) byTail.set(tail, []);
      byTail.get(tail)!.push(f);
    }
    // an aircraft on ground: a tail whose every leg cancels itself and that has an AOG disruption targeting it
    const aogTails = new Set((timeline?.disruptions ?? []).filter((d) => d.type === "AOG").map((d) => d.target));
    const q = opts.query.trim().toLowerCase();
    const rows: Row[] = [];
    for (const [tail, legs] of byTail) {
      legs.sort((a, b) => a.std - b.std);
      const touched = !!diff && legs.some((l) => diff.byId.has(l.id));
      if (opts.view === "changes" && !touched) continue;
      if (opts.airport && !legs.some((l) => l.origin === opts.airport || l.dest === opts.airport)) continue;
      const atRisk = legs.filter((l) => l.at_risk || l.status === "CANCELLED_FORCED").length;
      const forced = legs.filter((l) => l.status === "CANCELLED_FORCED").length;
      if (opts.onlyAtRisk && atRisk === 0 && !touched) continue;
      if (q && !tail.toLowerCase().includes(q) && !legs.some((l) => l.number.toLowerCase().replace(/\s/g, "").includes(q.replace(/\s/g, "")))) continue;
      rows.push({ tail, legs, atRisk, forced, aog: aogTails.has(tail), touched });
    }
    rows.sort((a, b) => Number(b.aog) - Number(a.aog) || b.forced - a.forced || b.atRisk - a.atRisk || a.tail.localeCompare(b.tail));
    return { rows, byId, disruptions: timeline?.disruptions ?? [] };
  }, [timeline, after, diff, opts.query, opts.onlyAtRisk, opts.view, opts.airport]);
}

export { stripState };
