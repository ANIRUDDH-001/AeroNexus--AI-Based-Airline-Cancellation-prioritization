"use client";
import type { Plan, Run, TimelineFlight } from "@/lib/api";
import { fmt, hhmm, inr, minutes } from "@/lib/format";
import { GLOSSARY, metricTerm, term } from "@/lib/glossary";
import { Define } from "@/components/ui/overlay";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";

export const HEADLINE_METRICS: [string, "count" | "inr" | "min"][] = [
  ["forced_downstream_cancellations", "count"],
  ["pax_stranded_overnight", "count"],
  ["misconnects", "count"],
  ["propagated_delay_min", "min"],
  ["compensation_inr", "inr"],
];

export function metricValue(kind: "count" | "inr" | "min" | "hours" | "score", v: number | undefined): string {
  if (v == null) return "—";
  if (kind === "inr") return inr(v);
  if (kind === "min") return minutes(v);
  if (kind === "hours") return `${fmt(v, 1)} h`;
  if (kind === "score") return fmt(v);
  return fmt(v);
}

/** "Cancel 6E 2011 Delhi–Mumbai 05:40 and re-fleet 6E 2087 onto VT-IFM; hold 6E 2044 by 40 min." */
export function actionSentence(plan: Plan, flights: Map<string, TimelineFlight>, airportNames: Map<string, string>): string {
  if (!plan.actions.length) return "Wait. Take no action now; re-check at the next decision time.";
  const name = (c: string) => airportNames.get(c) ?? c;
  const parts = plan.actions.map((a) => {
    const fs = (a.target_flights ?? []).map((id) => flights.get(id));
    const first = fs[0];
    const label = (f: TimelineFlight | undefined, id: string) => (f ? `${f.number} ${name(f.origin)}–${name(f.dest)} ${hhmm(f.std)}` : id);
    const params = (a.params ?? {}) as Record<string, unknown>;
    if (a.type === "CANCEL_CYCLE") {
      const nums = fs.map((f, i) => f?.number ?? a.target_flights?.[i] ?? "").join(", ");
      return `cancel the ${fs.length}-leg cycle ${nums}${first ? ` from ${name(first.origin)} ${hhmm(first.std)}` : ""}`;
    }
    if (a.type === "CANCEL_LEG") return `cancel ${fs.map((f, i) => label(f, a.target_flights?.[i] ?? "")).join(" and ")}`;
    if (a.type === "DELAY") return `hold ${label(first, a.target_flights?.[0] ?? "")} by ${params.delay_min ?? "?"} min`;
    if (a.type === "SWAP") return `re-fleet ${label(first, a.target_flights?.[0] ?? "")} onto ${params.swap_tail ?? "another aircraft"}`;
    return a.type.toLowerCase();
  });
  const s = parts.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

export function PreventsLine({ prevents, size = "md" }: { prevents: { cancellations: number; stranded: number; delayMin: number; misconnects: number }; size?: "md" | "sm" }) {
  const items: { v: number; label: string; fmt: (n: number) => string }[] = [
    { v: prevents.cancellations, label: "cancellations", fmt: (n: number) => fmt(n) },
    { v: prevents.stranded, label: "stranded passengers", fmt: (n: number) => fmt(n) },
    { v: prevents.delayMin, label: "of delay", fmt: (n: number) => minutes(n) },
    { v: prevents.misconnects, label: "missed connections", fmt: (n: number) => fmt(n) },
  ].filter((i) => i.v > 0);
  if (!items.length) return <span className="text-ivory-2">Nothing beyond what doing nothing gives.</span>;
  return (
    <span className={cn("flex flex-wrap gap-x-4 gap-y-1", size === "sm" ? "text-[12.5px]" : "text-[14px]")}>
      {items.map((i) => (
        <span key={i.label}>
          <span className={cn("num font-semibold text-mint", size === "sm" ? "text-[13px]" : "text-[16px]")}>{i.fmt(i.v)}</span> <span className="text-ivory-2">{i.label}</span>
        </span>
      ))}
    </span>
  );
}

/** Reliability in plain lines: no bars, no percentages that imply statistics (spec §5.6). */
export function Reliability({ plan, compact = false }: { plan: Plan; compact?: boolean }) {
  const c = plan.explanation.confidence;
  const samples = c.samples ?? plan.scenario_stats?.samples ?? 0;
  const evaluated = c.uncertainty_evaluated ?? samples >= 3;
  const feasible = Math.round((c.feasible_share ?? 1) * samples);
  const best = c.stability != null ? Math.round(c.stability * samples) : null;
  const lines: { key: keyof typeof GLOSSARY; text: string; tone: "mint" | "amber" | "coral" | "neutral" }[] = [
    { key: "feasibility", text: `Feasible in ${feasible} of ${samples} sampled futures`, tone: c.feasibility === "certain" ? "mint" : c.feasibility === "probable" ? "amber" : "coral" },
  ];
  if (evaluated) {
    if (c.stability_label === "dominated") lines.push({ key: "dominated", text: "Dominated: a near-identical plan is at least as good in every sampled future", tone: "neutral" });
    else if (best != null) lines.push({ key: "stability", text: `Lowest-impact plan in ${best} of ${samples} sampled futures`, tone: c.stability_label === "stable" ? "mint" : c.stability_label === "sensitive" ? "amber" : "coral" });
    if (c.scenario_sensitivity_label) lines.push({ key: "sensitivity", text: `Sensitivity to the uncertain parts: ${c.scenario_sensitivity_label}`, tone: c.scenario_sensitivity_label === "low" ? "mint" : c.scenario_sensitivity_label === "moderate" ? "amber" : "coral" });
    lines.push({ key: "samples", text: `${samples} futures sampled`, tone: "neutral" });
  } else {
    lines.push({ key: "uncertainty_not_evaluated", text: `Uncertainty not evaluated (${samples} sample${samples === 1 ? "" : "s"} fitted in the time budget)`, tone: "amber" });
  }
  if (compact) return <div className="text-[12px] text-ivory-2">{lines.map((l) => l.text).join(". ")}.</div>;
  return (
    <ul className="space-y-1 text-[12.5px]">
      {lines.map((l) => (
        <li key={l.key} className="flex items-start gap-2">
          <span aria-hidden className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", l.tone === "mint" ? "bg-mint" : l.tone === "amber" ? "bg-amber" : l.tone === "coral" ? "bg-coral" : "bg-ivory-3")} />
          <Define short={term(l.key).short} label={term(l.key).label} className="text-ivory-2">
            {l.text}
          </Define>
        </li>
      ))}
    </ul>
  );
}

/** This plan vs if nobody acts, the headline outcomes, better in mint, worse in coral. */
export function ResultTable({ plan, baseline, rows = HEADLINE_METRICS, headers = ["Plan", "If nobody acts"] }: { plan: Plan; baseline: Record<string, number>; rows?: [string, "count" | "inr" | "min"][]; headers?: [string, string] }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-[11px] text-ivory-3">
          <th className="pb-1 text-left font-medium">
            <Define short={GLOSSARY.network_impact.short} long={GLOSSARY.network_impact.long} label="Result">
              Result
            </Define>
          </th>
          <th className="num pb-1 text-right font-medium">{headers[0]}</th>
          <th className="num pb-1 text-right font-medium">{headers[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, kind]) => {
          const a = plan.metrics?.[k];
          const b = baseline[k];
          const better = a != null && b != null && a < b;
          const worse = a != null && b != null && a > b;
          const t = metricTerm(k);
          return (
            <tr key={k} className="border-t border-hairline">
              <td className="py-1 pr-2 text-ivory-2">
                <Define short={t.short} long={t.long} label={t.label}>
                  {t.label}
                </Define>
              </td>
              <td className={cn("num py-1 text-right", better && "text-mint", worse && "text-coral")}>{metricValue(kind, a)}</td>
              <td className="num py-1 text-right text-ivory-3">{metricValue(kind, b)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ScoreDefine({ plan, run }: { plan: Plan; run: Run }) {
  const base = run.baseline_metrics ? run.plans.find((p) => !p.actions.length)?.nis : undefined;
  return (
    <Define label="Network impact" short={`Network impact ${fmt(plan.nis)}${base != null ? ` against ${fmt(base)} if nobody acts` : ""}. ${GLOSSARY.network_impact.short}`} long={GLOSSARY.network_impact.long} className="text-ivory-3">
      score
    </Define>
  );
}

export function OriginTag({ origin }: { origin: "live" | "demo" | null }) {
  if (!origin) return null;
  return origin === "live" ? (
    <Define short={GLOSSARY.live_engine.short}>
      <Pill tone="mint">Live engine</Pill>
    </Define>
  ) : (
    <Define short={GLOSSARY.demo_result.short}>
      <Pill tone="amber">Demo result</Pill>
    </Define>
  );
}
