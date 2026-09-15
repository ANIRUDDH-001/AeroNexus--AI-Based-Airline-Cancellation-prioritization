import type { Plan, Run, Timeline, TimelineFlight } from "./api";

/** Compares the day if nobody acts with the day under a plan. One computation feeds the board's changed-strip
 *  outlines and "changes only" view, the map's per-airport deltas, the "impact avoided" line and the
 *  What-changed panel (spec §10.2). */

export type StripState = "on_time" | "delayed" | "at_risk" | "cancels_itself" | "cancelled_by_plan" | "already_happened";

export function stripState(f: TimelineFlight): StripState {
  if (f.status === "CANCELLED_FORCED") return "cancels_itself";
  if (f.status === "CANCELLED_DECISION") return "cancelled_by_plan";
  if (f.status === "PAST") return "already_happened";
  if (f.at_risk) return "at_risk";
  if (f.delay_min > 0) return "delayed";
  return "on_time";
}

export type FlightChange = {
  id: string;
  before: TimelineFlight;
  after: TimelineFlight;
  /** "protected": would have cancelled itself, now operates. */
  kind: "protected" | "cancelled_by_plan" | "re_fleeted" | "held" | "delay_changed" | "now_cancels" | "other";
  label: string;
};

export type Diff = {
  changes: FlightChange[];
  byId: Map<string, FlightChange>;
  tails: Set<string>;
  protectedIds: string[];
  cancelledByPlanIds: string[];
  reFleetedIds: string[];
  airportDelta: Map<string, { before: number; after: number }>;
  prevents: { cancellations: number; stranded: number; delayMin: number; misconnects: number };
};

function forcedSet(tl: Timeline): Set<string> {
  return new Set(tl.flights.filter((f) => f.status === "CANCELLED_FORCED").map((f) => f.id));
}

function atRiskByAirport(tl: Timeline): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of tl.flights) {
    if (!f.at_risk && f.status !== "CANCELLED_FORCED") continue;
    for (const c of [f.origin, f.dest]) m.set(c, (m.get(c) ?? 0) + 1);
  }
  return m;
}

export function diffTimelines(before: Timeline, after: Timeline): Diff {
  const b = new Map(before.flights.map((f) => [f.id, f]));
  const forcedBefore = forcedSet(before);
  const changes: FlightChange[] = [];
  for (const a of after.flights) {
    const f = b.get(a.id);
    if (!f) continue;
    let kind: FlightChange["kind"] | null = null;
    let label = "";
    if (forcedBefore.has(a.id) && a.status !== "CANCELLED_FORCED" && a.status !== "CANCELLED_DECISION") {
      kind = "protected";
      label = "protected";
    } else if (a.status === "CANCELLED_DECISION" && f.status !== "CANCELLED_DECISION") {
      kind = "cancelled_by_plan";
      label = "cancelled by plan";
    } else if (a.status === "CANCELLED_FORCED" && f.status !== "CANCELLED_FORCED") {
      kind = "now_cancels";
      label = "cancels itself";
    } else if (a.tail && f.tail && a.tail !== f.tail) {
      kind = "re_fleeted";
      label = `was ${f.tail}`;
    } else if (a.delay_min !== f.delay_min) {
      const d = a.delay_min - f.delay_min;
      kind = d > 0 && !f.at_risk ? "held" : "delay_changed";
      label = `${d > 0 ? "+" : "−"}${Math.abs(d)} min`;
    } else if (a.status !== f.status || a.at_risk !== f.at_risk) {
      kind = "other";
      label = a.at_risk ? "at risk" : "clear";
    }
    if (kind) changes.push({ id: a.id, before: f, after: a, kind, label });
  }
  const byId = new Map(changes.map((c) => [c.id, c]));
  const tails = new Set(changes.map((c) => c.after.tail ?? c.before.tail ?? "").filter(Boolean));
  const ab = atRiskByAirport(before);
  const aa = atRiskByAirport(after);
  const airportDelta = new Map<string, { before: number; after: number }>();
  for (const code of new Set([...ab.keys(), ...aa.keys()])) {
    const x = ab.get(code) ?? 0;
    const y = aa.get(code) ?? 0;
    if (x !== y) airportDelta.set(code, { before: x, after: y });
  }
  const sb = before.summary;
  const sa = after.summary;
  return {
    changes,
    byId,
    tails,
    protectedIds: changes.filter((c) => c.kind === "protected").map((c) => c.id),
    cancelledByPlanIds: changes.filter((c) => c.kind === "cancelled_by_plan").map((c) => c.id),
    reFleetedIds: changes.filter((c) => c.kind === "re_fleeted").map((c) => c.id),
    airportDelta,
    prevents: {
      cancellations: sb.forced_cancellations - sa.forced_cancellations,
      stranded: sb.stranded_overnight - sa.stranded_overnight,
      delayMin: sb.total_delay_min - sa.total_delay_min,
      misconnects: sb.misconnects - sa.misconnects,
    },
  };
}

/** What a plan prevents, from the run's own metrics when no after-timeline is loaded yet (baseline − plan). */
export function preventsFromRun(run: Run, plan: Plan): { cancellations: number; stranded: number; delayMin: number; misconnects: number } {
  const b = run.baseline_metrics ?? {};
  const m = plan.metrics ?? {};
  const d = (k: string) => (b[k] ?? 0) - (m[k] ?? 0);
  return { cancellations: d("forced_downstream_cancellations"), stranded: d("pax_stranded_overnight"), delayMin: d("propagated_delay_min"), misconnects: d("misconnects") };
}
