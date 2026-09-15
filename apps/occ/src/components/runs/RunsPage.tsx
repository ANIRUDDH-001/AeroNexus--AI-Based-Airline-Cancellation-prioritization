"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, type RunRow } from "@/lib/api";
import { keys } from "@/lib/query";
import { fmt, hhmm, seconds } from "@/lib/format";
import { GLOSSARY, term } from "@/lib/glossary";
import { useDay } from "@/hooks/useDay";
import { useIsPhone } from "@/hooks/useIsTouch";
import { useTimeline } from "@/hooks/useTimeline";
import { Panel, EmptyState, Skeleton } from "@/components/ui/panel";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { Define, Sheet } from "@/components/ui/overlay";
import { Pill } from "@/components/ui/pill";
import { Switch } from "@/components/ui/controls";
import { PlanCard } from "@/components/plans/PlanCard";
import { OriginTag } from "@/components/plans/shared";
import { PARAM_CLOCK, PARAM_DAY, PARAM_RUN, withParams } from "@/lib/url";

function statusOf(r: RunRow): { label: string; tone: "mint" | "amber" | "neutral" } {
  if (r.accepted_plan != null) return { label: `plan ${r.accepted_plan} accepted`, tone: "mint" };
  if (r.override_reason) return { label: `overridden: ${r.override_reason}`, tone: "amber" };
  return { label: "recommended", tone: "neutral" };
}

/** Runs (spec §7): every recommendation, with its audit trail; a row opens the run read-only. */
export function RunsPage() {
  const { dayId, days } = useDay();
  const params = useSearchParams();
  const phone = useIsPhone();
  const [allDays, setAllDays] = useState(false);
  const [openId, setOpenId] = useState<string | null>(params.get(PARAM_RUN));
  const runs = useQuery({ queryKey: keys.runs(allDays ? undefined : dayId ?? ""), queryFn: () => api.runs(allDays ? undefined : dayId!), enabled: allDays || !!dayId });
  const rows = useMemo(() => (runs.data?.data ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)), [runs.data]);
  const dayName = (id: string) => days.find((d) => d.id === id)?.name ?? id;
  return (
    <>
      <Panel
        title="Recommendations"
        aside={
          <>
            <OriginTag origin={runs.data?.origin ?? null} />
            <Switch checked={allDays} onChange={setAllDays} label={<span className="text-[12px] text-ivory-2">All days</span>} />
          </>
        }
        bodyClassName="p-0"
      >
        {runs.isPending ? (
          <div className="space-y-2 p-3.5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState className="m-3.5 border-0">No recommendations yet. Ask for one on the operations screen.</EmptyState>
        ) : phone ? (
          <ul className="divide-y divide-hairline">
            {rows.map((r) => {
              const s = statusOf(r);
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpenId(r.id)} className="w-full px-3.5 py-3 text-left hover:bg-ivory-soft">
                    <div className="flex items-center gap-2">
                      <span className="mono text-[13px] text-ivory">{hhmm(r.decision_time)}</span>
                      <Pill tone={s.tone}>{s.label}</Pill>
                    </div>
                    <div className="mt-1 text-[12.5px] text-ivory-2">{r.top_plan.join(" + ") || "do nothing"}</div>
                    <div className="mt-0.5 text-[11.5px] text-ivory-3">{r.created_at.slice(0, 16).replace("T", " ")}, {r.at_risk} at risk, {seconds(r.latency_ms)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Table containerClassName="max-h-[70vh]">
            <thead>
              <tr>
                <Th>when</Th>
                {allDays && <Th>day</Th>}
                <Th>decision time</Th>
                <Th>recommended</Th>
                <Th>status</Th>
                <Th num>at risk</Th>
                <Th num>plans evaluated</Th>
                <Th>budget used</Th>
                <Th num>time</Th>
                <Th>
                  <Define short={GLOSSARY.config_hash.short}>configuration</Define>
                </Th>
                <Th>
                  <Define short={GLOSSARY.instance_hash.short}>day fingerprint</Define>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = statusOf(r);
                const e = r.effective ?? {};
                return (
                  <Tr key={r.id} onClick={() => setOpenId(r.id)} selected={openId === r.id}>
                    <Td mono>{r.created_at.slice(0, 16).replace("T", " ")}</Td>
                    {allDays && <Td>{dayName(r.instance_id)}</Td>}
                    <Td mono>{hhmm(r.decision_time)}</Td>
                    <Td className="max-w-[360px]">{r.top_plan.join(" + ") || "do nothing"}</Td>
                    <Td>
                      <Pill tone={s.tone}>{s.label}</Pill>
                    </Td>
                    <Td num>{r.at_risk}</Td>
                    <Td num>{fmt(r.plans_evaluated)}</Td>
                    <Td className="text-ivory-2">
                      {e.samples != null ? `${e.samples} futures, depth ${e.depth ?? "?"}` : "—"}
                      {e.deterministic ? ", deterministic" : ""}
                    </Td>
                    <Td num>{seconds(r.latency_ms)}</Td>
                    <Td mono className="text-ivory-3">{r.config_hash}</Td>
                    <Td mono className="text-ivory-3">{r.instance_hash?.slice(0, 12) ?? "—"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)} title="Recommendation" width={760}>
        {openId && <RunDetail runId={openId} rows={rows} />}
      </Sheet>
    </>
  );
}

function RunDetail({ runId, rows }: { runId: string; rows: RunRow[] }) {
  const q = useQuery({ queryKey: keys.run(runId), queryFn: () => api.run(runId) });
  const row = rows.find((r) => r.id === runId);
  const { timeline } = useTimeline();
  const flights = useMemo(() => new Map((timeline?.flights ?? []).map((f) => [f.id, f])), [timeline]);
  const airportsQ = useQuery({ queryKey: keys.table(row?.instance_id ?? "", "airports"), queryFn: () => api.table(row!.instance_id, "airports"), enabled: !!row, staleTime: 5 * 60_000 });
  const airportNames = useMemo(() => new Map((airportsQ.data?.data.rows ?? []).map((r) => [String(r.code), String(r.name ?? r.code)])), [airportsQ.data]);
  if (q.isPending) return <Skeleton className="h-40" />;
  const run = q.data?.data;
  if (!run) return <p className="text-[13px] text-coral">{q.error instanceof Error ? q.error.message : "Could not load the run."}</p>;
  const open = row ? `/${withParams("", { [PARAM_DAY]: row.instance_id, [PARAM_CLOCK]: run.decision_time, [PARAM_RUN]: run.id })}` : "/";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ivory-2">
        <OriginTag origin={q.data?.origin ?? null} />
        <span>
          {hhmm(run.decision_time)} on {run.instance_name}, {run.plans.length} plans, {fmt(run.plans_evaluated)} evaluated, {seconds(run.latency_ms)}
        </span>
        {run.effective?.deterministic && (
          <Define short={term("deterministic").short}>
            <Pill tone="neutral">deterministic replay</Pill>
          </Define>
        )}
        <Link href={open} className="ml-auto">
          Open this day at {hhmm(run.decision_time)}
        </Link>
      </div>
      {run.plans.map((p, i) => (
        <PlanCard key={p.rank ?? i} plan={p} run={run} flights={flights} airportNames={airportNames} diff={null} recommended={i === 0} status={run.accepted_plan === p.rank ? { kind: "accepted", at: run.decision_time } : run.override_reason && i === 0 ? { kind: "overridden", reason: run.override_reason } : i === 0 ? { kind: "recommended" } : null} shownOnBoard={false} onShow={() => undefined} onAccept={() => undefined} onOverride={() => undefined} canDecide={false} disabledReason="Decisions are taken on the operations screen." />
      ))}
    </div>
  );
}
