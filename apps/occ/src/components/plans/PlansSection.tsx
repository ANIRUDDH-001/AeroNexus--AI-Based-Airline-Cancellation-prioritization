"use client";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, needsWriteKey, type Plan, type Run, type Timeline, type TimelineFlight } from "@/lib/api";
import { keys } from "@/lib/query";
import { diffTimelines, type Diff } from "@/lib/diff";
import { fmt, hhmm, inr, minutes, plural, seconds } from "@/lib/format";
import { GLOSSARY, term } from "@/lib/glossary";
import { useEngine } from "@/hooks/useEngine";
import { usePlanTimeline } from "@/hooks/useTimeline";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Define, Dialog, Sheet } from "@/components/ui/overlay";
import { Select, Input, Field } from "@/components/ui/controls";
import { PlanCard, type PlanStatus } from "./PlanCard";
import { OriginTag, actionSentence } from "./shared";
import { cn } from "@/lib/utils";

const OVERRIDE_REASONS = ["Crew preference", "Commercial priority", "Operational information not in the system", "Weather outlook differs", "Other"];

export type PlansState = {
  run: Run | null;
  origin: "live" | "demo" | null;
  shownPlan: Plan | null;
  after: Timeline | null;
  diff: Diff | null;
};

/** The plans section (spec §5.6): baseline → recommended → alternatives; the invitation when there is no run;
 *  honest progress while the engine works; What changed after a decision. */
export function PlansSection({
  dayId,
  clock,
  timeline,
  flights,
  airportNames,
  runId,
  onRunId,
  shownRank,
  onShownRank,
  onDecided,
}: {
  dayId: string;
  clock: number;
  timeline: Timeline;
  flights: Map<string, TimelineFlight>;
  airportNames: Map<string, string>;
  runId: string | null;
  onRunId: (id: string | null) => void;
  shownRank: number | null;
  onShownRank: (rank: number | null) => void;
  onDecided: () => void;
}) {
  const qc = useQueryClient();
  const { demo, state } = useEngine();
  const [elapsed, setElapsed] = useState(0);
  const [accepting, setAccepting] = useState<Plan | null>(null);
  const [overriding, setOverriding] = useState<Plan | null>(null);
  const [overrideReason, setOverrideReason] = useState(OVERRIDE_REASONS[0]);
  const [overrideNote, setOverrideNote] = useState("");
  const [why, setWhy] = useState<Plan | null>(null);
  const [collapsedChanged, setCollapsedChanged] = useState(false);

  const runQ = useQuery({ queryKey: keys.run(runId ?? ""), queryFn: () => api.run(runId!), enabled: !!runId });
  const run = runQ.data?.data && runQ.data.data.decision_time === clock ? runQ.data.data : null;
  const origin = runQ.data?.origin ?? null;
  const shownPlan = useMemo(() => (run && shownRank != null ? run.plans.find((p) => p.rank === shownRank) ?? null : null), [run, shownRank]);
  const { timeline: after } = usePlanTimeline(shownPlan?.actions ?? null);
  const diff = useMemo(() => (after ? diffTimelines(timeline, after) : null), [timeline, after]);

  const recommend = useMutation({
    mutationFn: () => api.recommend({ instance_id: dayId, decision_time: clock, seed: 1, previous_run_id: run?.id ?? null }),
    onSuccess: (r) => {
      qc.setQueryData(keys.run(r.data.id), r);
      void qc.invalidateQueries({ queryKey: keys.runs(dayId) });
      onRunId(r.data.id);
      onShownRank(r.data.plans[0]?.rank ?? null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The engine could not produce a plan"),
  });
  // "Ask for a plan after changes" from the disruption sheet
  useEffect(() => {
    const h = () => recommend.mutate();
    window.addEventListener("aeronexus:recommend", h);
    return () => window.removeEventListener("aeronexus:recommend", h);
  }, [recommend]);
  useEffect(() => {
    if (!recommend.isPending) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [recommend.isPending]);

  const decide = useMutation({
    mutationFn: (body: { accepted_plan: number | null; override_reason: string | null }) => api.decide(run!.id, body),
    onSuccess: async (r, body) => {
      qc.setQueryData(keys.run(r.data.id), r);
      await qc.invalidateQueries();
      onDecided();
      toast(body.accepted_plan != null ? `Plan ${body.accepted_plan} accepted` : "Override recorded");
      setCollapsedChanged(false);
    },
    onError: (e) => toast.error(needsWriteKey(e) ? "Deciding needs the write key" : e instanceof Error ? e.message : "Could not record the decision"),
  });

  const s = timeline.summary;
  const baseline = run?.baseline_metrics ?? {};
  // the budget ran out before a single action was simulated: only "do nothing" was scored, so nothing is recommended
  const exhausted = !!run && run.depth_reached === 0 && run.plans_evaluated <= 1;
  const cfgQ = useQuery({ queryKey: keys.config, queryFn: () => api.config(), staleTime: 5 * 60_000, enabled: exhausted });
  const budgetMs = cfgQ.data?.data.config.search?.latency_budget_ms;
  const canDecide = !!run && !demo && state === "online" && run.accepted_plan == null && !run.override_reason;
  const disabledReason = demo ? "Unavailable while the engine is asleep; wake it to decide." : run?.accepted_plan != null ? "A plan is already accepted at this decision time." : run?.override_reason ? "An override is recorded at this decision time." : null;
  const status = (p: Plan): PlanStatus | null => {
    if (!run) return null;
    if (run.accepted_plan != null) return run.accepted_plan === p.rank ? { kind: "accepted", at: run.decision_time } : null;
    if (run.override_reason) return p.rank === 1 ? { kind: "overridden", reason: run.override_reason } : null;
    return p.rank === 1 && !exhausted ? { kind: "recommended" } : null;
  };
  const decided = run && (run.accepted_plan != null || !!run.override_reason);
  const acceptedPlan = run && run.accepted_plan != null ? run.plans.find((p) => p.rank === run.accepted_plan) ?? null : null;

  const nextDecision = useMemo(() => {
    const next = timeline.flights
      .filter((f) => (f.at_risk || f.status === "CANCELLED_FORCED") && f.std > clock)
      .map((f) => f.std)
      .sort((a, b) => a - b)[0];
    const t = next != null ? Math.floor(next / 15) * 15 : clock + 60;
    return Math.min(1425, Math.max(clock + 15, t));
  }, [timeline.flights, clock]);

  return (
    <Panel
      title={run ? `Plans at ${hhmm(clock)}` : `Plans`}
      aside={
        run ? (
          <>
            <OriginTag origin={origin} />
            <span className="hidden sm:inline">
              {plural(run.plans.length, "plan")}, {run.effective?.samples != null ? plural(run.effective.samples, "future") : "? futures"} sampled, {seconds(run.latency_ms)}
            </span>
            {run.effective?.deterministic && (
              <Define short={GLOSSARY.deterministic.short}>
                <span className="text-ivory-3">deterministic</span>
              </Define>
            )}
            <Button size="sm" variant="ghost" onClick={() => recommend.mutate()} disabled={recommend.isPending || demo}>
              Run again
            </Button>
          </>
        ) : null
      }
      bodyClassName="p-3.5"
    >
      {/* What changed, once a decision is recorded at this time (server state, so it survives navigation) */}
      {decided && run && !collapsedChanged && (
        <WhatChanged run={run} plan={acceptedPlan} diff={diff} flights={flights} airportNames={airportNames} clock={clock} nextDecision={nextDecision} onStay={() => setCollapsedChanged(true)} />
      )}
      {decided && run && collapsedChanged && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-panel border border-mint/40 bg-mint-soft px-3 py-2 text-[12.5px]">
          <span>
            Decision committed at {hhmm(clock)}: {run.accepted_plan != null ? `plan ${run.accepted_plan}` : `override, ${run.override_reason}`}.
          </span>
          <button type="button" onClick={() => setCollapsedChanged(false)} className="underline underline-offset-[3px]">
            details
          </button>
        </div>
      )}

      <div className={cn("grid gap-3", run ? "lg:grid-cols-[260px_minmax(0,1fr)]" : "")}>
        <BaselineCard summary={s} baseline={baseline} hasRun={!!run} />

        {!run && !recommend.isPending && (
          <div className="flex flex-col items-start justify-center gap-3 rounded-panel border border-dashed border-hairline-strong p-5">
            <p className="text-[15px] text-ivory">
              {s.at_risk > 0 ? `${s.at_risk} flights are at risk at ${hhmm(clock)}. Ask the engine for a plan.` : `Nothing to decide at ${hhmm(clock)}. Move the decision time or add a disruption.`}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={() => recommend.mutate()} disabled={state === "connecting"}>
                {demo ? "Load the precomputed recommendation" : "Get a recommendation"}
              </Button>
              <span className="text-[12.5px] text-ivory-3">{demo ? "Computed earlier by the same engine and stored." : "Usually 2–5 seconds on the live engine."}</span>
            </div>
          </div>
        )}

        {recommend.isPending && <RunProgress elapsed={elapsed} />}

        {run && !recommend.isPending && (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            {exhausted && (
              <div className="rounded-panel border border-amber/50 bg-amber-soft p-4 text-[13.5px]">
                <h3 className="text-[15px] font-medium text-ivory">No action could be evaluated in the search budget{budgetMs ? ` of ${seconds(budgetMs)}` : ""}.</h3>
                <p className="mt-1.5 text-ivory-2">
                  The engine spent the whole budget preparing candidates for {plural(s.at_risk, "at-risk flight")} and stopped before simulating a single one. The only plan it scored is doing nothing, so there is nothing to recommend yet.
                </p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px] text-ivory-3">
                  {run.notes.filter((n) => /budget|uncertainty/.test(n)).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => recommend.mutate()} disabled={demo || state !== "online"}>
                    Run again
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href="/parameters?tab=search">Raise the search budget</a>
                  </Button>
                  <span className="text-[12px] text-ivory-3">A day this size needs a budget of 30–60 s.</span>
                </div>
              </div>
            )}
            {run.plans.slice(0, 1).map((p) => (
              <PlanCard
                key={p.rank}
                plan={p}
                run={run}
                flights={flights}
                airportNames={airportNames}
                diff={shownRank === p.rank ? diff : null}
                recommended={!exhausted}
                status={status(p)}
                shownOnBoard={shownRank === p.rank}
                onShow={() => onShownRank(p.rank)}
                onAccept={() => setAccepting(p)}
                onOverride={() => setOverriding(p)}
                onWhyOverNext={run.plans.length > 1 ? () => setWhy(p) : undefined}
                canDecide={canDecide}
                disabledReason={disabledReason}
              />
            ))}
            <div className="space-y-3">
              {run.plans.slice(1).map((p) => (
                <PlanCard
                  key={p.rank}
                  plan={p}
                  run={run}
                  flights={flights}
                  airportNames={airportNames}
                  diff={shownRank === p.rank ? diff : null}
                  recommended={false}
                  status={status(p)}
                  shownOnBoard={shownRank === p.rank}
                  onShow={() => onShownRank(p.rank)}
                  onAccept={() => setAccepting(p)}
                  onOverride={() => setOverriding(p)}
                  canDecide={canDecide}
                  disabledReason={disabledReason}
                />
              ))}
              {run.plans.length === 1 && !exhausted && (
                <p className="text-[12.5px] text-ivory-3">
                  {(run.excluded?.length ?? 0) > 0 ? `No alternative met the hard rules (${plural(run.excluded?.length ?? 0, "candidate")} ruled out).` : "Every alternative had the same outcome as doing nothing."}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* accept: spell out what gets committed */}
      <Dialog
        open={!!accepting}
        onOpenChange={(o) => !o && setAccepting(null)}
        title={accepting ? `Accept plan ${accepting.rank}?` : ""}
        description={accepting ? `This commits to the day: ${actionSentence(accepting, flights, airportNames).replace(/\.$/, "")}. The day replays from ${hhmm(clock)} with these fixed; later recommendations build on them.` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAccepting(null)}>
              Not yet
            </Button>
            <Button
              variant="primary"
              disabled={decide.isPending}
              onClick={() => {
                if (accepting) decide.mutate({ accepted_plan: accepting.rank, override_reason: null });
                setAccepting(null);
              }}
            >
              Accept
            </Button>
          </>
        }
      />
      <Dialog
        open={!!overriding}
        onOpenChange={(o) => !o && setOverriding(null)}
        title="Record an override"
        description="The recommendation stays on record; the day is not changed. Say why, so the case can be reviewed later."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOverriding(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate({ accepted_plan: null, override_reason: overrideNote.trim() ? `${overrideReason}: ${overrideNote.trim()}` : overrideReason });
                setOverriding(null);
              }}
            >
              Record override
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Reason">
            <Select value={overrideReason} onChange={setOverrideReason} options={OVERRIDE_REASONS.map((r) => ({ value: r, label: r }))} ariaLabel="Override reason" className="w-full" />
          </Field>
          <Field label="Note (optional)">
            <Input value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} placeholder="What the engine could not know" />
          </Field>
        </div>
      </Dialog>

      {/* why plan 1 over plan 2: the engine's own differences side by side */}
      <Sheet open={!!why} onOpenChange={(o) => !o && setWhy(null)} title={why ? `Why plan ${why.rank} over plan ${(why.rank ?? 1) + 1}?` : ""} width={520}>
        {why && run && <WhyOverNext plan={why} next={run.plans.find((p) => p.rank === (why.rank ?? 1) + 1) ?? null} flights={flights} airportNames={airportNames} />}
      </Sheet>
    </Panel>
  );
}

function BaselineCard({ summary, baseline, hasRun }: { summary: Timeline["summary"]; baseline: Record<string, number>; hasRun: boolean }) {
  const rows: { key: keyof typeof GLOSSARY; value: string; tone?: "coral" | "amber" }[] = [
    { key: "forced_cancellations", value: fmt(summary.forced_cancellations), tone: summary.forced_cancellations ? "coral" : undefined },
    { key: "stranded_overnight", value: fmt(summary.stranded_overnight), tone: summary.stranded_overnight ? "coral" : undefined },
    { key: "misconnects", value: fmt(summary.misconnects), tone: summary.misconnects ? "amber" : undefined },
    { key: "total_delay_min", value: minutes(summary.total_delay_min) },
  ];
  return (
    <article className={cn("rounded-panel border border-hairline-strong/60 bg-transparent p-4", !hasRun && "lg:max-w-[360px]")} aria-label="If nobody acts">
      <h3 className="text-[13px] font-semibold text-ivory-2">
        <Define short={GLOSSARY.if_nobody_acts.short} label="If nobody acts">
          If nobody acts
        </Define>
      </h3>
      <dl className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-3 text-[13px]">
            <dt className="text-ivory-2">
              <Define short={term(r.key).short} long={term(r.key).long}>
                {term(r.key).label}
              </Define>
            </dt>
            <dd className={cn("num font-semibold", r.tone === "coral" ? "text-coral" : r.tone === "amber" ? "text-amber" : "text-ivory")}>{r.value}</dd>
          </div>
        ))}
        {baseline.compensation_inr != null && (
          <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-1.5 text-[12.5px]">
            <dt className="text-ivory-3">
              <Define short={GLOSSARY.compensation_inr.short}>compensation</Define>
            </dt>
            <dd className="num text-ivory-2">{inr(baseline.compensation_inr)}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

const STAGES = [
  ["Propagating the day", "replaying every rotation, crew and connection under the disruptions"],
  ["Building candidate actions", "cancel, hold or re-fleet each at-risk flight, filtered by the hard rules"],
  ["Searching plans", "beam search over combinations, each evaluated by a full-day simulation"],
  ["Sampling uncertain futures", "re-running the finalists across draws of when the disruption ends"],
] as const;

function RunProgress({ elapsed }: { elapsed: number }) {
  return (
    <div className="rounded-panel border border-hairline bg-well p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[13.5px] text-ivory">The engine is working</span>
        <span className="mono text-[12.5px] text-ivory-2">{seconds(elapsed)}</span>
      </div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-hairline-strong">
        <div className="h-full w-1/3 animate-[progress_1.4s_ease-in-out_infinite] rounded-full bg-amber" />
      </div>
      <ol className="mt-3 grid gap-1.5 text-[12.5px] sm:grid-cols-2">
        {STAGES.map(([name, what], i) => (
          <li key={name} className="flex gap-2">
            <span className="mono text-ivory-3">{i + 1}</span>
            <span>
              <span className="text-ivory">{name}</span>
              <span className="text-ivory-3">, {what}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function WhatChanged({ run, plan, diff, flights, airportNames, clock, nextDecision, onStay }: { run: Run; plan: Plan | null; diff: Diff | null; flights: Map<string, TimelineFlight>; airportNames: Map<string, string>; clock: number; nextDecision: number; onStay: () => void }) {
  const { setClock } = useDayForPlans();
  const counts = plan
    ? plan.actions.reduce(
        (acc, a) => {
          const n = a.target_flights?.length ?? 0;
          if (a.type === "CANCEL_LEG" || a.type === "CANCEL_CYCLE") acc.cancelled += n;
          else if (a.type === "SWAP") acc.refleeted += n;
          else if (a.type === "DELAY") acc.held += n;
          return acc;
        },
        { cancelled: 0, refleeted: 0, held: 0 },
      )
    : null;
  const b = run.baseline_metrics ?? {};
  const m = plan?.metrics ?? {};
  const avoided = { cancellations: (b.forced_downstream_cancellations ?? 0) - (m.forced_downstream_cancellations ?? 0), stranded: (b.pax_stranded_overnight ?? 0) - (m.pax_stranded_overnight ?? 0) };
  return (
    <div className="mb-3 rounded-panel border border-mint/40 bg-mint-soft p-4">
      <h3 className="text-[15px] font-semibold text-ivory">
        Decision committed at {hhmm(clock)}: {plan ? `plan ${plan.rank}` : `override, ${run.override_reason}`}
      </h3>
      {plan && counts ? (
        <div className="mt-2 grid gap-3 text-[13px] sm:grid-cols-2">
          <div>
            <div className="text-[11.5px] text-ivory-3">Changed</div>
            <p className="text-ivory">
              {[counts.cancelled && `${counts.cancelled} flight${counts.cancelled === 1 ? "" : "s"} cancelled`, counts.refleeted && `${counts.refleeted} re-fleeted`, counts.held && `${counts.held} held`].filter(Boolean).join(", ") || "nothing"}
              {diff && diff.protectedIds.length > 0 && `; ${diff.protectedIds.map((id) => flights.get(id)?.number ?? id).join(", ")} protected`}
            </p>
            <p className="mt-0.5 text-ivory-2">{actionSentence(plan, flights, airportNames)}</p>
          </div>
          <div>
            <div className="text-[11.5px] text-ivory-3">Protected</div>
            <p className="text-ivory">
              {avoided.cancellations > 0 ? `${avoided.cancellations} cancellation${avoided.cancellations === 1 ? "" : "s"} avoided` : "no cancellations avoided"}
              {avoided.stranded > 0 ? `, ${fmt(avoided.stranded)} passengers no longer stranded` : avoided.stranded < 0 ? `, ${fmt(-avoided.stranded)} more passengers stranded than doing nothing` : ""}.
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-[13px] text-ivory-2">Recorded: override, no change to the day. The recommendation stays in Runs.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setClock(nextDecision)}>
          Continue to the next decision ({hhmm(nextDecision)})
        </Button>
        <Button variant="ghost" onClick={onStay}>
          Stay at {hhmm(clock)}
        </Button>
      </div>
    </div>
  );
}

function WhyOverNext({ plan, next, flights, airportNames }: { plan: Plan; next: Plan | null; flights: Map<string, TimelineFlight>; airportNames: Map<string, string> }) {
  const w = plan.explanation.why_over_next;
  return (
    <div className="space-y-4 text-[13px]">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-panel border border-ivory/40 p-3">
          <div className="text-[11.5px] text-ivory-3">Plan {plan.rank}</div>
          <p className="mt-1 text-ivory">{actionSentence(plan, flights, airportNames)}</p>
        </div>
        <div className="rounded-panel border border-hairline p-3">
          <div className="text-[11.5px] text-ivory-3">Plan {next?.rank ?? "?"}</div>
          <p className="mt-1 text-ivory-2">{next ? actionSentence(next, flights, airportNames) : "—"}</p>
        </div>
      </div>
      {w ? (
        <>
          <p className="text-ivory">{w.verdict.replace(/#(\d)/g, "Plan $1")}.</p>
          <ul className="space-y-1">
            {w.differences.map((d, i) => {
              const favoursThis = d.startsWith(`#${plan.rank}`);
              return (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", favoursThis ? "bg-mint" : "bg-amber")} />
                  <span className="text-ivory-2">{d.replace(/#(\d)/g, "plan $1")}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-[12px] text-ivory-3">Differences are in network-impact points; 1 point is about ₹1,000. {GLOSSARY.network_impact.long}</p>
        </>
      ) : (
        <p className="text-ivory-2">The engine did not record a comparison for these two plans.</p>
      )}
    </div>
  );
}

// the What-changed panel moves the clock; it lives inside the plans section so it can read the day hook here
import { useDay } from "@/hooks/useDay";
function useDayForPlans() {
  return useDay();
}
