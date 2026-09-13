import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Play, RefreshCw } from "lucide-react";
import { api, ApiError, fmt, type Action, type Plan, type Run, type Timeline as TimelineData, staticMode } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button, Card, Empty, PageTitle, Tag, inputCls } from "@/components/Shell";
import { Timeline } from "@/components/Timeline";

const LEVELS: { key: string; label: string }[] = [
  { key: "level:L1", label: "Network" },
  { key: "level:L2", label: "Passengers" },
  { key: "level:L3", label: "Cost" },
  { key: "level:L4", label: "Robustness" },
];
const OVERRIDE_REASONS = ["Crew preference", "Commercial priority", "Operational information not in system", "Weather outlook differs", "Other"];

function ConfidenceChips({ p }: { p: Plan }) {
  const c = p.explanation.confidence;
  const evaluated = c.uncertainty_evaluated ?? c.samples >= 3;
  const feasTone = c.feasibility === "certain" ? "ok" : c.feasibility === "probable" ? "warn" : "bad";
  const stabTone = c.stability_label === "stable" ? "ok" : c.stability_label === "sensitive" ? "warn" : c.stability_label === "dominated" ? "gray" : c.stability_label ? "bad" : "gray";
  const sensTone = c.scenario_sensitivity_label === "low" ? "ok" : c.scenario_sensitivity_label === "moderate" ? "warn" : "bad";
  return (
    <div className="flex flex-wrap gap-1.5">
      <Tag tone={feasTone} title={`feasible in ${Math.round(c.feasible_share * 100)}% of ${c.samples} sampled future(s)`}>
        feasibility: {c.feasibility}
      </Tag>
      {evaluated ? (
        <>
          <Tag tone={stabTone} title="share of sampled futures in which this plan is the best of the finalists; 'dominated' = a near-identical plan always edges it out">
            stability: {c.stability_label} ({Math.round((c.stability ?? 0) * 100)}%)
          </Tag>
          <Tag tone={sensTone} title="(P90 − mean) / mean across sampled futures">
            scenario sensitivity: {c.scenario_sensitivity_label}
          </Tag>
        </>
      ) : (
        <Tag tone="warn" title="Fewer than 3 sampled futures fitted in the latency budget on this machine, so stability and sensitivity were not evaluated. Set search.deterministic for the full readout.">
          uncertainty not evaluated ({c.samples} sample{c.samples === 1 ? "" : "s"})
        </Tag>
      )}
      <Tag tone="gray">{c.data_freshness_min == null ? "data: synthetic day" : `data age ${c.data_freshness_min} min`}</Tag>
    </div>
  );
}

function LevelBars({ p, max }: { p: Plan; max: number }) {
  return (
    <div className="space-y-1">
      {LEVELS.map((l) => {
        const v = p.nis_breakdown[l.key] ?? 0;
        return (
          <div key={l.key} className="flex items-center gap-2 text-[12px]">
            <span className="w-20 text-ink-2">{l.label}</span>
            <div className="flex-1 h-2 rounded bg-hover overflow-hidden">
              <div className="h-2 bg-accent/70 rounded" style={{ width: `${max ? Math.min(100, (v / max) * 100) : 0}%` }} />
            </div>
            <span className="w-16 text-right font-mono">{fmt(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function PlanCard({ p, run, maxLevel, onAccept, onOverride, decided }: { p: Plan; run: Run; maxLevel: number; onAccept: () => void; onOverride: (reason: string) => void; decided: boolean }) {
  const [open, setOpen] = useState(p.rank === 1);
  const [reason, setReason] = useState(OVERRIDE_REASONS[0]);
  const isAccepted = run.accepted_plan === p.rank;
  const m = p.metrics;
  return (
    <Card className={p.rank === 1 ? "border-accent" : ""}>
      <div className="flex items-start gap-3">
        <button className="mt-0.5 text-ink-2" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[16px] font-semibold">#{p.rank}</span>
            {p.actions.length === 0 ? <span className="font-medium">Do nothing</span> : p.explanation.actions.map((a, i) => <Tag key={i}>{a}</Tag>)}
            {isAccepted && <Tag tone="ok">accepted</Tag>}
            <span className="ml-auto text-[13px] text-ink-2">
              NIS <span className="font-mono text-ink font-medium">{fmt(p.nis)}</span>
              {p.scenario_stats && <span className="ml-2">(bad case {fmt(p.scenario_stats.p90)})</span>}
            </span>
          </div>
          <ul className="mt-2 text-[13px] space-y-0.5">
            {p.explanation.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
          <div className="mt-2">
            <ConfidenceChips p={p} />
          </div>
          {p.explanation.equivalent_alternatives.length > 0 && (
            <div className="mt-2 text-[12px] text-ink-2">Same outcome with: {p.explanation.equivalent_alternatives.map((alt) => alt.join(" + ")).join(" · ")}</div>
          )}
          {open && (
            <div className="mt-4 grid grid-cols-2 gap-6">
              <div>
                <div className="text-[12px] font-medium text-ink-2 mb-1">Score by level (points ≈ ₹ thousand)</div>
                <LevelBars p={p} max={maxLevel} />
                {p.explanation.why_over_next && (
                  <div className="mt-3 text-[12px]">
                    <div className="font-medium text-ink-2 mb-1">Why this over #{(p.rank ?? 0) + 1}</div>
                    <div>{p.explanation.why_over_next.verdict}</div>
                    <ul className="text-ink-2 mt-1">
                      {p.explanation.why_over_next.differences.map((d, i) => (
                        <li key={i}>– {d}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="text-[12px]">
                <div className="font-medium text-ink-2 mb-1">Outcome</div>
                <table className="ax-table">
                  <tbody>
                    {[
                      ["Downstream cancellations", m.forced_downstream_cancellations, run.baseline_metrics.forced_downstream_cancellations],
                      ["Passengers on cancelled flights", m.pax_cancelled, run.baseline_metrics.pax_cancelled],
                      ["Re-accommodated same day", m.pax_reprotected_same_day, run.baseline_metrics.pax_reprotected_same_day],
                      ["Stranded overnight", m.pax_stranded_overnight, run.baseline_metrics.pax_stranded_overnight],
                      ["Missed connections", m.misconnects, run.baseline_metrics.misconnects],
                      ["Propagated delay (min)", m.propagated_delay_min, run.baseline_metrics.propagated_delay_min],
                      ["Standby crews used", m.crew_standby_used, run.baseline_metrics.crew_standby_used],
                      ["Compensation (₹)", m.compensation_inr, run.baseline_metrics.compensation_inr],
                    ].map(([label, v, b]) => (
                      <tr key={String(label)}>
                        <td className="text-ink-2">{label}</td>
                        <td className="font-mono text-right">{fmt(v as number)}</td>
                        <td className="font-mono text-right text-ink-2">{Number(v) === Number(b) ? "" : `(do nothing: ${fmt(b as number)})`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {p.explanation.forced_cancellations.length > 0 && (
                  <div className="mt-2">
                    <div className="font-medium text-ink-2">Forced cancellations under this plan</div>
                    {p.explanation.forced_cancellations.map((f) => (
                      <div key={f.flight} className="text-ink-2">
                        {f.flight}: {f.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {!decided && (
            <div className="mt-4 flex items-center gap-2">
              <Button onClick={onAccept}>
                <Check size={14} /> Accept #{p.rank}
              </Button>
              <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
                {OVERRIDE_REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <Button variant="ghost" onClick={() => onOverride(reason)}>
                Override with reason
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function RecommendationsPage() {
  const { instanceId, clock, lastRunId, setLastRunId } = useStore();
  const [run, setRun] = useState<Run | null>(null);
  const [tl, setTl] = useState<TimelineData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wiType, setWiType] = useState<Action["type"]>("CANCEL_LEG");
  const [wiFlight, setWiFlight] = useState("");
  const [wiParam, setWiParam] = useState("60");
  const [whatif, setWhatif] = useState<Run | null>(null);

  useEffect(() => {
    setRun(null);
    setWhatif(null);
    if (!instanceId) return;
    api.timeline(instanceId, clock).then(setTl).catch(() => setTl(null));
    // static demo mode serves the nearest precomputed run, whose decision time may differ from the slider
    if (lastRunId) api.run(lastRunId).then((r) => { if (r.decision_time === clock || staticMode.active) setRun(r); }).catch(() => undefined);
  }, [instanceId, clock, lastRunId]);

  const recommend = async () => {
    if (!instanceId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.recommend({ instance_id: instanceId, decision_time: clock, previous_run_id: run?.id ?? null });
      setRun(r);
      setLastRunId(r.id);
      setWhatif(null);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  };
  const decide = async (accepted: number | null, reason: string | null) => {
    if (!run) return;
    setError(null);
    try {
      setRun(await api.decide(run.id, { accepted_plan: accepted, override_reason: reason }));
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    }
  };
  const evalWhatIf = async () => {
    if (!instanceId || !wiFlight) return;
    setBusy(true);
    setError(null);
    try {
      const a: Action = { type: wiType, target_flights: [wiFlight], params: wiType === "DELAY" ? { delay_min: Number(wiParam) } : wiType === "SWAP" ? { swap_tail: wiParam } : {} };
      if (wiType === "CANCEL_CYCLE" && tl) {
        const f = tl.flights.find((x) => x.id === wiFlight);
        const rot = f?.tail ? tl.rotations[f.tail] ?? [] : [];
        const i = rot.indexOf(wiFlight);
        const cyc: string[] = [];
        for (let j = i; j >= 0 && j < rot.length && cyc.length < 4; j++) {
          cyc.push(rot[j]);
          const g = tl.flights.find((x) => x.id === rot[j]);
          if (g && f && g.dest === f.origin) break;
        }
        a.target_flights = cyc;
      }
      setWhatif(await api.whatif({ instance_id: instanceId, decision_time: clock, actions: [a] }));
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  };

  const maxLevel = useMemo(() => Math.max(1, ...(run?.plans ?? []).flatMap((p) => LEVELS.map((l) => p.nis_breakdown[l.key] ?? 0))), [run]);
  const highlight = useMemo(() => (run?.plans[0]?.actions ?? []).flatMap((a) => a.target_flights), [run]);
  const decided = !!run && run.accepted_plan != null;

  if (!instanceId) return <PageTitle title="Recommendations" subtitle="Load an operational day first (Data page)." />;

  return (
    <>
      <PageTitle
        title="Recommendations"
        subtitle="The engine simulates the most promising feasible options on the shared operational state, extends the best into multi-step plans, and returns the three best with reasons. You decide."
        right={
          <Button onClick={recommend} disabled={busy}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} {run ? "Re-run" : "Recommend"}
          </Button>
        }
      />
      {error && <p className="mb-3 text-[13px] text-bad">{error}</p>}
      {!run && !busy && <Empty>{tl ? `${tl.summary.at_risk} flight(s) at risk at ${tl.clock_hhmm}. Run the engine to get ranked plans.` : "Loading…"}</Empty>}

      {run && (
        <>
          <div className="mb-4 flex flex-wrap gap-3 text-[12px] text-ink-2 items-center">
            <span>
              {run.at_risk.length} at risk · {run.plans_evaluated} plans simulated · depth {run.depth_reached}
              {run.effective ? ` · ${run.effective.samples} sampled future${run.effective.samples === 1 ? "" : "s"}` : ""} · {fmt(run.latency_ms)} ms
              {run.effective?.deterministic ? " · audit mode" : ""}
            </span>
            <span className="font-mono">config {run.config_hash}</span>
            <span className="font-mono">run {run.id}</span>
            {run.notes.map((n, i) => (
              <Tag key={i} tone="gray">
                {n}
              </Tag>
            ))}
            {run.accepted_plan != null && (
              <Tag tone="ok">
                decision recorded: plan #{run.accepted_plan}
                {run.override_reason ? ` (override: ${run.override_reason})` : ""}
              </Tag>
            )}
          </div>
          {run.narrative && (
            <p className="mb-4 text-[13px] border-l-2 border-accent pl-3 text-ink-2">
              <span className="text-[11px] uppercase tracking-wide text-ink-2 mr-2" title="Reworded from the computed facts; numbers and flights are checked against them. Never part of the decision.">
                narration
              </span>
              {run.narrative}
            </p>
          )}
          {run.plans.length === 0 && <Empty>Recommendation unavailable — no feasible plan could be evaluated.</Empty>}
          <div className="space-y-3">
            {run.plans.map((p) => (
              <PlanCard
                key={p.rank}
                p={p}
                run={run}
                maxLevel={maxLevel}
                decided={decided}
                onAccept={() => decide(p.rank, null)}
                onOverride={(reason) => decide(p.rank, reason)}
              />
            ))}
          </div>

          {tl && (
            <Card className="mt-6">
              <div className="font-medium mb-2">Rotations (current state; plan #1 targets highlighted)</div>
              <Timeline flights={tl.flights} rotations={tl.rotations} clock={tl.clock} highlight={highlight} />
            </Card>
          )}

          <Card className="mt-6">
            <div className="font-medium mb-1">What if…</div>
            <p className="text-[12px] text-ink-2 mb-3">Evaluate your own option on the same engine and see where it would rank.</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[12px] text-ink-2">
                Action
                <select className={`${inputCls} mt-1 block`} value={wiType} onChange={(e) => setWiType(e.target.value as Action["type"])}>
                  <option value="CANCEL_LEG">Cancel leg</option>
                  <option value="CANCEL_CYCLE">Cancel cycle</option>
                  <option value="DELAY">Delay</option>
                  <option value="SWAP">Swap aircraft</option>
                </select>
              </label>
              <label className="text-[12px] text-ink-2">
                Flight
                <select className={`${inputCls} mt-1 block w-56`} value={wiFlight} onChange={(e) => setWiFlight(e.target.value)}>
                  <option value="">— choose —</option>
                  {(tl?.flights ?? []).filter((f) => f.status !== "PAST" && f.status !== "CANCELLED_DECISION").map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.number} {f.origin}→{f.dest} {f.std_hhmm}
                      {f.at_risk ? " ⚠" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {wiType === "DELAY" && (
                <label className="text-[12px] text-ink-2">
                  Minutes
                  <input className={`${inputCls} mt-1 block w-24`} value={wiParam} onChange={(e) => setWiParam(e.target.value)} />
                </label>
              )}
              {wiType === "SWAP" && (
                <label className="text-[12px] text-ink-2">
                  Onto tail
                  <select className={`${inputCls} mt-1 block`} value={wiParam} onChange={(e) => setWiParam(e.target.value)}>
                    <option value="">— tail —</option>
                    {Object.keys(tl?.rotations ?? {}).map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              )}
              <Button variant="ghost" onClick={evalWhatIf} disabled={busy || !wiFlight}>
                Evaluate
              </Button>
            </div>
            {whatif && whatif.whatif[0] && (
              <div className="mt-4 text-[13px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag tone="blue">{whatif.whatif[0].explanation.actions.join(" + ")}</Tag>
                  <span>
                    would rank <span className="font-semibold">#{whatif.whatif[0].rank}</span> with NIS <span className="font-mono">{fmt(whatif.whatif[0].nis)}</span>
                    {whatif.plans[0] && (
                      <span className="text-ink-2">
                        {" "}
                        vs {fmt(whatif.plans[0].nis)} for the recommendation
                      </span>
                    )}
                  </span>
                </div>
                <ul className="mt-2 space-y-0.5">
                  {whatif.whatif[0].explanation.reasons.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
                {whatif.whatif[0].explanation.vs_top && (
                  <div className="mt-2 text-ink-2">
                    {whatif.whatif[0].explanation.vs_top.verdict}: {whatif.whatif[0].explanation.vs_top.differences.join("; ")}
                  </div>
                )}
              </div>
            )}
          </Card>

          {run.excluded.length > 0 && (
            <Card className="mt-6">
              <div className="font-medium mb-2">Options ruled out by hard constraints</div>
              <table className="ax-table">
                <thead>
                  <tr>
                    <th>Option</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {run.excluded.map((a, i) => (
                    <tr key={i}>
                      <td className="font-mono text-[12px]">
                        {a.type} {a.target_flights.join("+")}
                        {a.params && Object.keys(a.params).length ? ` ${JSON.stringify(a.params)}` : ""}
                      </td>
                      <td className="text-ink-2">{a.feasibility?.reasons.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </>
  );
}
