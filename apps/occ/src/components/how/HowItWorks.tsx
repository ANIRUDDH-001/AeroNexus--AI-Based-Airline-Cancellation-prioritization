"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { keys } from "@/lib/query";
import { fmt, hhmm, inr, minutes, seconds } from "@/lib/format";
import { GLOSSARY, type Term } from "@/lib/glossary";
import { useDay } from "@/hooks/useDay";
import { useTimeline } from "@/hooks/useTimeline";
import { Define } from "@/components/ui/overlay";
import { Panel } from "@/components/ui/panel";
import { useNavHref } from "@/components/shell/TopBar";
import { describeDisruption } from "@/components/disruptions/describe";
import { OriginTag } from "@/components/plans/shared";

/** How it works (spec §7): seven steps, a real sequence, each with today's actual numbers and what it is not. */
export function HowItWorks() {
  const { dayId, day, clock } = useDay();
  const { timeline } = useTimeline();
  const withState = useNavHref();
  const runs = useQuery({ queryKey: keys.runs(dayId ?? ""), queryFn: () => api.runs(dayId!), enabled: !!dayId });
  const latestRow = useMemo(() => (runs.data?.data ?? []).filter((r) => r.decision_time === clock).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? (runs.data?.data ?? [])[0], [runs.data, clock]);
  const runQ = useQuery({ queryKey: keys.run(latestRow?.id ?? ""), queryFn: () => api.run(latestRow!.id), enabled: !!latestRow });
  const cfg = useQuery({ queryKey: keys.config, queryFn: () => api.config(), staleTime: 5 * 60_000 });
  const run = runQ.data?.data ?? null;
  const s = timeline?.summary;
  const search = cfg.data?.data.config.search;
  const top = run?.plans[0] ?? null;
  const n = (v: number | undefined | null) => (v == null ? "—" : fmt(v));

  const steps: { title: string; numbers: React.ReactNode; text: string; not?: string }[] = [
    {
      title: "Today's day",
      numbers: timeline ? <>{n(s?.flights)} flights, {Object.keys(timeline.rotations).length} aircraft, {timeline.disruptions.length} disruption{timeline.disruptions.length === 1 ? "" : "s"}{timeline.disruptions.length ? `: ${timeline.disruptions.map((d) => describeDisruption(d)).join("; ")}` : ""}.</> : "No day open.",
      text: "A day is a schedule (flights on aircraft rotations), the crews and their duty limits, the airports with their slots, curfews and stands, the passengers with their connections, and whatever has gone wrong. Every number the console shows is computed from this data.",
      not: "The days are synthetic, IndiGo-like in shape; nothing here is a real schedule or a real booking.",
    },
    {
      title: "What happens if nobody acts",
      numbers: s ? <>{n(s.forced_cancellations)} flights cancel themselves, {n(s.stranded_overnight)} passengers stranded overnight, {n(s.misconnects)} missed connections, {minutes(s.total_delay_min)} of delay, from {hhmm(clock)}.</> : "—",
      text: "The simulator replays the whole day from the decision time: each leg needs its aircraft at the origin, a legal crew, a slot and an open airport; delays propagate through the rotation and the crews; passengers miss connections. Flights that cannot operate cancel themselves. This is the baseline every plan is compared with.",
      not: "Everything before the decision time is the engine's own forecast under the decisions already committed, not a live feed.",
    },
    {
      title: "Candidate actions",
      numbers: run ? <>{n(run.at_risk.length)} flights at risk; for each, cancel the leg, cancel its cycle, hold it (steps of {search?.delay_steps_min?.join(", ") ?? "30, 60, 90"} min) or re-fleet it; {search ? `${search.M} candidates kept per step` : ""}.</> : "Ask for a recommendation to see the numbers.",
      text: "Only at-risk flights get candidate actions. Every candidate is checked against the hard rules first (aircraft continuity, crew limits, curfews, slots, protected flights); anything that breaks one is ruled out and listed with the reason.",
    },
    {
      title: "Search",
      numbers: run ? <>{n(run.plans_evaluated)} plans evaluated, combining up to {run.depth_reached} actions, {seconds(run.latency_ms)}.</> : "—",
      text: `A beam search: keep the ${search?.K ?? 5} best partial plans, extend each with the next candidate, simulate the whole day for each, keep the best again, up to ${search?.D ?? 3} actions deep. Every plan's score comes from a full-day simulation, not from a formula.`,
      not: "No model chooses the plan. The ML pre-ranker only orders candidates so the search tries promising ones first; it can be switched off and the answer is the same, only slower.",
    },
    {
      title: "Sampled futures",
      numbers: run ? <>{n(run.effective?.samples)} futures sampled per finalist for {n(search?.N)} finalists{top?.scenario_stats?.values?.length ? `; plan 1 ranges ${n(Math.min(...top.scenario_stats.values))} to ${n(Math.max(...top.scenario_stats.values))} across them` : top?.scenario_stats ? `; plan 1 averages ${n(top.scenario_stats.mean)}, bad case ${n(top.scenario_stats.p90)}` : ""}.</> : "—",
      text: "The uncertain parts of the day, such as when the fog lifts, are drawn several times and the finalists replayed under each draw. That is where feasibility, stability and sensitivity come from: counts over sampled futures, not probabilities.",
    },
    {
      title: "Ranking",
      numbers: top ? <>Plan 1 scores {n(top.nis)}{top.scenario_stats ? ` (bad case ${n(top.scenario_stats.p90)})` : ""}; {inr(top.metrics.compensation_inr)} compensation under the plan, {inr(run?.baseline_metrics?.compensation_inr)} if nobody acts.</> : "—",
      text: "Each outcome (cancellations, delay, stranded passengers, compensation and the rest) is weighted into one network impact; 1 point is about ₹1,000. Level-1 terms decide first, lower levels break ties. The top three plans with different decisions are returned, so the alternatives are real alternatives.",
      not: "The score ranks plans; it is not money the airline pays, and the weights are placeholders for the method, not calibrated airline values.",
    },
    {
      title: "Your decision",
      numbers: timeline ? <>{timeline.committed.count} decision{timeline.committed.count === 1 ? "" : "s"} committed today{timeline.committed.count ? `: ${timeline.committed.labels.join("; ")}` : ""}.</> : "—",
      text: "A person accepts a plan or records an override. An accepted plan is committed to the day: the day replays with it fixed, the next recommendation builds on it, and the run keeps its record (configuration fingerprint, day fingerprint, budget used) so it can be audited later.",
    },
  ];

  return (
    <div className="space-y-5">
      <p className="max-w-[80ch] text-[13.5px] text-ivory-2">
        The numbers below are live for {day ? <span className="text-ivory">{day.name}</span> : "the open day"} at {hhmm(clock)}
        {run ? <> and the latest recommendation there (<OriginTag origin={runQ.data?.origin ?? null} />)</> : ""}. <Link href={withState("/")}>Back to operations</Link>
      </p>
      <ol className="space-y-3">
        {steps.map((st, i) => (
          <li key={st.title} className="grid gap-3 rounded-panel border border-hairline bg-panel p-4 md:grid-cols-[48px_minmax(0,1fr)]">
            <div className="mono text-[22px] font-medium leading-none text-ivory-3">{i + 1}</div>
            <div>
              <h3 className="text-[15px] font-semibold text-ivory">{st.title}</h3>
              <p className="mt-1 text-[14px] text-ivory">{st.numbers}</p>
              <p className="mt-1.5 max-w-[80ch] text-[13px] text-ivory-2">{st.text}</p>
              {st.not && <p className="mt-1.5 max-w-[80ch] text-[12.5px] text-ivory-3">What this is not: {st.not}</p>}
            </div>
          </li>
        ))}
      </ol>
      <Panel title="Glossary" bodyClassName="p-0">
        <dl className="grid gap-x-6 md:grid-cols-2">
          {Object.entries(GLOSSARY as Record<string, Term>).map(([k, t]) => (
            <div key={k} className="border-b border-hairline px-3.5 py-2 text-[12.5px]">
              <dt className="text-ivory">
                <Define short={t.short} long={t.long}>
                  {t.label}
                </Define>
              </dt>
              <dd className="text-ivory-2">{t.short}{t.long ? ` ${t.long}` : ""}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
