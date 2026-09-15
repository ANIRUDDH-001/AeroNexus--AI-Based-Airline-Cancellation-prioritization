"use client";
import type { Plan, Run, TimelineFlight } from "@/lib/api";
import type { Diff } from "@/lib/diff";
import { fmt } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { Define } from "@/components/ui/overlay";
import { CausalChain } from "./CausalChain";
import { ResultTable, metricValue } from "./shared";
import { FuturesStrip } from "@/components/charts/FuturesStrip";

const FEATURE_WORDS: Record<string, (v: number) => string> = {
  act_cancel_leg: () => "it cancels one leg",
  act_cancel_cycle: () => "it cancels a whole cycle",
  act_delay: () => "it holds a flight",
  act_swap: () => "it re-fleets",
  delay_min: (v) => `a hold of ${v} min`,
  cycle_len: (v) => `a ${v}-leg cycle`,
  swap_same_type: (v) => (v ? "the swap keeps the aircraft type" : "the swap changes aircraft type"),
  booked_pax: (v) => `${fmt(v)} passengers booked`,
  pax_connecting: (v) => `${fmt(v)} connecting passengers`,
  pax_special: (v) => `${fmt(v)} passengers needing assistance`,
  pax_high_value: (v) => `${fmt(v)} high-value passengers`,
  pax_partner: (v) => `${fmt(v)} partner passengers`,
  block_min: (v) => `a ${v}-minute block`,
  std_hour: (v) => `departure around ${String(Math.floor(v)).padStart(2, "0")}:00`,
  origin_is_hub: (v) => (v ? "it departs a hub" : "it departs a spoke"),
  dest_is_hub: (v) => (v ? "it arrives at a hub" : "it arrives at a spoke"),
  load_factor: (v) => `load factor ${Math.round(v * 100)}%`,
  base_forced: (v) => (v ? "the flight cancels itself if nobody acts" : "the flight operates if nobody acts"),
  base_delay_min: (v) => `${v} min of delay if nobody acts`,
  base_standby_called: (v) => (v ? "a standby crew is already needed" : "no standby crew needed"),
  minutes_to_departure: (v) => `${fmt(v)} min to departure`,
  legs_after_on_tail: (v) => `${v} more legs on this aircraft today`,
  pax_after_on_tail: (v) => `${fmt(v)} passengers on this aircraft's later legs`,
  legs_before_on_tail: (v) => `${v} legs already flown by this aircraft`,
  crew_sectors_after: (v) => `${v} more sectors for the crew`,
  crew_fdp_margin_min: (v) => `${fmt(v)} min of crew duty margin`,
  spare_tails_at_origin: (v) => `${v} spare aircraft at the origin`,
  standby_crews_at_origin: (v) => `${v} standby crews at the origin`,
  same_od_alternatives_later: (v) => `${v} later flights on the same route`,
  spare_seats_same_od_later: (v) => `${fmt(v)} spare seats on later flights of the same route`,
  origin_capacity_cut: (v) => (v ? "the origin has a capacity cut" : "no capacity cut at the origin"),
  dest_capacity_cut: (v) => (v ? "the destination has a capacity cut" : "no capacity cut at the destination"),
  origin_lvp: (v) => (v ? "fog at the origin" : "no fog at the origin"),
  dest_lvp: (v) => (v ? "fog at the destination" : "no fog at the destination"),
  tail_aog: (v) => (v ? "its aircraft is on ground" : "its aircraft is serviceable"),
  n_at_risk_total: (v) => `${v} flights at risk in total`,
};

/** "How this plan was found": four labelled blocks so the kinds of reasoning never blur (spec §5.6). */
export function Expanded({ plan, run, flights, diff, baseline }: { plan: Plan; run: Run; flights: Map<string, TimelineFlight>; diff: Diff | null; baseline: Record<string, number> }) {
  const e = plan.explanation;
  const allMetricRows = Object.keys(plan.metrics ?? {})
    .filter((k) => k !== "tail_risk_penalty")
    .map((k) => [k, k.endsWith("_inr") ? "inr" : k.endsWith("_min") ? "min" : k.endsWith("_hours") ? "hours" : "count"] as [string, "count" | "inr" | "min" | "hours"]);
  const finalists = run.plans.map((p) => ({ label: p.rank === plan.rank ? `Plan ${p.rank} (this one)` : `Plan ${p.rank}`, values: p.scenario_stats?.values ?? [], mean: p.scenario_stats?.mean ?? p.nis, tone: p.rank === plan.rank ? ("ivory" as const) : ("muted" as const) }));
  const drivers = (e as { score_drivers?: { feature: string; value: number; contribution: number }[] }).score_drivers ?? [];
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <section className="space-y-2">
        <h4 className="text-[12px] font-semibold text-ivory">Operational reason</h4>
        <p className="text-[12px] text-ivory-3">What the decisions do to aircraft, crews and passengers, as the simulator replayed it.</p>
        <CausalChain plan={plan} flights={flights} diff={diff} limit={40} />
        <ul className="space-y-1 text-[12.5px] text-ivory-2">
          {e.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {e.equivalent_alternatives.length > 0 && (
          <p className="text-[12px] text-ivory-3">Same outcome with: {e.equivalent_alternatives.map((alt) => alt.join(" + ")).join("; ")}.</p>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-[12px] font-semibold text-ivory">Search result</h4>
        <p className="text-[12px] text-ivory-3">
          {fmt(run.plans_evaluated)} plans evaluated to depth {run.depth_reached}, {run.effective?.samples ?? plan.scenario_stats?.samples ?? "?"} futures sampled per finalist
          {run.effective?.budget_cuts?.length ? `; the time budget cut ${run.effective.budget_cuts.join(", ")}` : ""}.
        </p>
        <FuturesStrip rows={finalists} />
        <div className="max-h-[260px] overflow-auto rounded-panel border border-hairline bg-well p-2">
          <ResultTable plan={plan} baseline={baseline} rows={allMetricRows as [string, "count" | "inr" | "min"][]} />
        </div>
        <p className="text-[12px] text-ivory-3">
          Network impact {fmt(plan.nis)}
          {plan.scenario_stats ? `, bad case ${fmt(plan.scenario_stats.p90)}` : ""}. {GLOSSARY.network_impact.short}
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-[12px] font-semibold text-ivory">ML pre-ranking</h4>
        <p className="text-[12px] text-ivory-3">The model only orders candidates for simulation; the plan was chosen by simulation and the hard rules.</p>
        {drivers.length ? (
          <ul className="space-y-1 text-[12.5px]">
            {drivers.map((d) => {
              const words = FEATURE_WORDS[d.feature]?.(d.value) ?? `${d.feature.replace(/_/g, " ")} = ${metricValue("count", d.value)}`;
              const lowers = d.contribution < 0; // negative contribution = lower predicted impact = more promising
              return (
                <li key={d.feature} className="flex items-start gap-2">
                  <span aria-hidden className={`mt-[6px] size-1.5 shrink-0 rounded-full ${lowers ? "bg-mint" : "bg-amber"}`} />
                  <span className="text-ivory-2">
                    {words}
                    <span className="text-ivory-3"> — {lowers ? "made it more promising" : "made it less promising"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ivory-2">{run.effective?.surrogate ? "Drivers are reported for the recommended plan only." : "The model was not used for this run; candidates were ordered by the built-in heuristic."}</p>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-[12px] font-semibold text-ivory">Narration</h4>
        {run.narrative ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-ivory-2">{run.narrative}</p>
            <p className="text-[11.5px] text-ivory-3">Written by the narration model from the plan&apos;s computed facts. It never takes part in the decision.</p>
          </>
        ) : (
          <p className="text-[12.5px] text-ivory-2">No narration for this run; the facts above are the record.</p>
        )}
        {run.notes.length > 0 && (
          <ul className="space-y-0.5 text-[11.5px] text-ivory-3">
            {run.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        <p className="text-[11.5px] text-ivory-3">
          <Define short={GLOSSARY.config_hash.short}>configuration</Define> <span className="mono">{run.config_hash}</span>
          {run.instance_hash && (
            <>
              , <Define short={GLOSSARY.instance_hash.short}>day</Define> <span className="mono">{run.instance_hash.slice(0, 12)}</span>
            </>
          )}
          {run.effective?.deterministic && (
            <>
              , <Define short={GLOSSARY.deterministic.short}>deterministic replay</Define>
            </>
          )}
        </p>
      </section>
    </div>
  );
}
