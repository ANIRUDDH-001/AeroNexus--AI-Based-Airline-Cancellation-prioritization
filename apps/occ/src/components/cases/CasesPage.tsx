"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, needsWriteKey, type Benchmark, type CaseResult, type CasesRun } from "@/lib/api";
import { keys } from "@/lib/query";
import { fmt, pct, seconds } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { useEngine } from "@/hooks/useEngine";
import { Panel, Skeleton } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Define } from "@/components/ui/overlay";
import { Pill } from "@/components/ui/pill";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { OriginTag } from "@/components/plans/shared";
import { BarList } from "@/components/charts/BarList";
import { cn } from "@/lib/utils";

const POLICY_WORDS: Record<string, string> = {
  do_nothing: "Do nothing",
  B0_naive: "Naive: cancel the first at-risk flight",
  B1_weighted: "Weighted rule of thumb",
  B2_aeronexus: "AeroNexus (search + simulation)",
  B2s_surrogate: "AeroNexus with the ML pre-ranker",
};

/** Cases & benchmarks (spec §7): the evidence that the approach works, kept off the operations screen. */
export function CasesPage() {
  const qc = useQueryClient();
  const { demo } = useEngine();
  // the engine only holds a case run after one has been made on it; until then the precomputed run stands in
  const cases = useQuery({
    queryKey: keys.cases,
    queryFn: async () => {
      try {
        return await api.latestCases();
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          const r = await fetch("/static-runs/cases.json");
          if (r.ok) return { data: (await r.json()) as CasesRun, origin: "demo" as const };
        }
        throw e;
      }
    },
    staleTime: 60_000,
  });
  const bench = useQuery({ queryKey: keys.benchmark, queryFn: () => api.benchmark(), staleTime: 60_000 });
  const [open, setOpen] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api.runCases({ use_surrogate: false }),
    onSuccess: (r) => {
      qc.setQueryData(keys.cases, r);
      toast(`${r.data.passed} of ${r.data.total} cases passed`);
    },
    onError: (e) => toast.error(needsWriteKey(e) ? "Running cases needs the write key" : e instanceof Error ? e.message : "Could not run the cases"),
  });
  const c: CasesRun | null = cases.data?.data ?? null;
  const b: Benchmark | null = bench.data?.data ?? null;
  const ax = b?.summary?.B2_aeronexus;
  const dn = b?.summary?.do_nothing;
  const b0 = b?.summary?.B0_naive;
  const improvementVsDoNothing = ax && dn && dn.nis_mean ? 1 - ax.nis_mean / dn.nis_mean : null;
  const policyRows = useMemo(() => (b ? Object.entries(b.summary).map(([k, v]) => ({ name: POLICY_WORDS[k] ?? k, value: v.nis_mean, sub: k === "B2_aeronexus" ? "recommended" : undefined })) : []), [b]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="cases passed" value={c ? `${c.passed} of ${c.total}` : "—"} tone={c && c.passed === c.total ? "mint" : "amber"} short="Hand-built days with a known right answer; the engine must find it." />
        <Kpi label="lower impact than doing nothing" value={improvementVsDoNothing != null ? pct(improvementVsDoNothing) : "—"} tone="mint" short="Across the benchmark days, how much lower the network impact of the recommended plan is than the day left alone." />
        <Kpi label="lower impact than the naive rule" value={ax ? pct(ax.improvement_vs_B0_pct / 100) : "—"} tone="mint" short="Against a rule of thumb that cancels the first at-risk flight." />
        <Kpi label="median time to a plan" value={ax ? seconds(ax.latency_ms_mean) : "—"} short="Mean time the engine took per benchmark day; the 95th percentile is in the ladder." />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Cases"
          aside={
            <>
              <OriginTag origin={cases.data?.origin ?? null} />
              {c && <span className="text-ivory-3">config {c.config_hash}{cases.data?.origin === "demo" ? ", precomputed" : ""}</span>}
              <Button size="sm" variant="outline" disabled={demo || run.isPending} onClick={() => run.mutate()} title={demo ? "Unavailable while the engine is asleep" : undefined}>
                {run.isPending ? "Running…" : "Run cases"}
              </Button>
            </>
          }
          bodyClassName="p-0"
        >
          {cases.isPending ? (
            <div className="space-y-2 p-3.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : !c ? (
            <p className="p-3.5 text-[13px] text-ivory-2">No case results yet.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {(c.results as CaseResult[]).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left hover:bg-ivory-soft">
                    <Pill tone={r.passed ? "mint" : "coral"}>{r.passed ? "passed" : "failed"}</Pill>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-ivory">{r.title}</div>
                      <div className="text-[12px] text-ivory-3">
                        expected {r.expected.join(", ")}; got {r.top1.join(" + ") || "do nothing"} ({r.matched}), {seconds(r.latency_ms)}
                      </div>
                    </div>
                  </button>
                  {open === r.id && (
                    <div className="space-y-2 bg-well px-3.5 py-3 text-[12.5px]">
                      <p className="whitespace-pre-line text-ivory-2">{r.rationale}</p>
                      <ul className="space-y-0.5">
                        {r.checks.map((k) => (
                          <li key={k} className="text-mint">{k}</li>
                        ))}
                        {r.failures.map((k) => (
                          <li key={k} className="text-coral">{k}</li>
                        ))}
                      </ul>
                      <div className="text-ivory-3">
                        {fmt(r.plans_evaluated)} plans evaluated; if nobody acts {r.baseline_forced} cancel themselves, under the plan {r.plan_forced}.
                      </div>
                      {r.excluded.length > 0 && (
                        <div className="text-ivory-3">
                          Ruled out by the hard rules: {r.excluded.map((x) => `${x.key} (${x.reasons[0]})`).join("; ")}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Benchmark ladder"
          aside={
            <>
              <OriginTag origin={bench.data?.origin ?? null} />
              {b && (
                <span className="text-ivory-3">
                  {b.scenarios} days, {b.s_eval} futures each
                </span>
              )}
              {b?.stale && (
                <Define short="The benchmark was computed with an earlier configuration; the numbers describe that engine, not the current one.">
                  <Pill tone="amber">older configuration</Pill>
                </Define>
              )}
            </>
          }
        >
          {bench.isPending ? (
            <Skeleton className="h-40" />
          ) : !b ? (
            <p className="text-[13px] text-ivory-2">No benchmark on record.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-[12px] text-ivory-3">
                  Mean <Define short={GLOSSARY.network_impact.short} long={GLOSSARY.network_impact.long}>network impact</Define> per policy, lower is better
                </div>
                <BarList items={policyRows} highlight={POLICY_WORDS.B2_aeronexus} />
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>policy</Th>
                    <Th num>impact</Th>
                    <Th num>bad case</Th>
                    <Th num>cancel themselves</Th>
                    <Th num>stranded</Th>
                    <Th num>missed connections</Th>
                    <Th num>wins vs naive</Th>
                    <Th num>time p95</Th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(b.summary).map(([k, v]) => (
                    <Tr key={k} className={cn(k === "B2_aeronexus" && "bg-ivory-soft")}>
                      <Td className="whitespace-nowrap">{POLICY_WORDS[k] ?? k}</Td>
                      <Td num>{fmt(v.nis_mean)}</Td>
                      <Td num>{fmt(v.nis_p90_mean)}</Td>
                      <Td num>{fmt(v.forced_mean, 1)}</Td>
                      <Td num>{fmt(v.pax_stranded_mean)}</Td>
                      <Td num>{fmt(v.misconnects_mean)}</Td>
                      <Td num>{k === "B0_naive" ? "—" : pct(v.win_rate_vs_B0)}</Td>
                      <Td num>{seconds(v.latency_ms_p95)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {b0 && ax && <p className="text-[12px] text-ivory-3">The naive rule is what a hurried desk does; AeroNexus wins {pct(ax.win_rate_vs_B0)} of days against it and ties {pct(ax.tie_rate_vs_B0)}.</p>}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="What this does not show">
        <ul className="grid gap-2 text-[12.5px] text-ivory-2 md:grid-cols-2">
          <li>Days are synthetic: IndiGo-like in shape (hubs, banks, fleet mix), not real schedules or bookings.</li>
          <li>Compensation and care are priced under the configured DGCA rules with values marked VERIFY; they are estimates, not forecasts.</li>
          <li>Fog is the weakest disruption type: its end time is sampled, so plans that depend on when it lifts carry the most uncertainty.</li>
          <li>The ML pre-ranker orders candidates for simulation. It adds speed, not quality: the benchmark row with and without it is the evidence.</li>
          <li>A 2,000-flight day is beyond the decision horizon the search handles in a few seconds; the benchmark stops at medium days.</li>
          <li>The realised past is the engine&apos;s own forecast under committed decisions, not a live feed.</li>
        </ul>
      </Panel>
    </div>
  );
}

function Kpi({ label, value, tone, short }: { label: string; value: string; tone?: "mint" | "amber"; short: string }) {
  return (
    <div className="rounded-panel border border-hairline bg-panel px-4 py-3">
      <div className={cn("num text-[24px] font-semibold leading-none", tone === "mint" ? "text-mint" : tone === "amber" ? "text-amber" : "text-ivory")}>{value}</div>
      <div className="mt-1.5 text-[12.5px] text-ivory-2">
        <Define short={short}>{label}</Define>
      </div>
    </div>
  );
}
