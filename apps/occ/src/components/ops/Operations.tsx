"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Plan, type Timeline } from "@/lib/api";
import { keys } from "@/lib/query";
import { diffTimelines } from "@/lib/diff";
import { PARAM_RUN, PARAM_SHEET, PARAM_VIEW, parseView, withParams } from "@/lib/url";
import { useDay } from "@/hooks/useDay";
import { useTimeline, usePlanTimeline } from "@/hooks/useTimeline";
import { useEngine } from "@/hooks/useEngine";
import { useIsPhone } from "@/hooks/useIsTouch";
import { useSwipeViews } from "@/hooks/useSwipeViews";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, Skeleton } from "@/components/ui/panel";
import { Board } from "@/components/board/Board";
import type { BoardView } from "@/components/board/useBoardData";
import { NetworkMap, type MapAirport } from "@/components/map/NetworkMap";
import { DisruptionsPanel } from "@/components/disruptions/DisruptionsPanel";
import { PlansSection } from "@/components/plans/PlansSection";
import { Headline } from "./Headline";
import { AtRiskList } from "./AtRiskList";
import { DecisionsList } from "./DecisionsList";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** The operations screen (spec §5): headline → board + side column → plans. On phones, ?view= shows one
 *  section at a time (Today / Board / Map / Plans). */
export function Operations() {
  const { dayId, clock, daysLoading, setClock } = useDay();
  const { timeline, loading, error } = useTimeline();
  const { state } = useEngine();
  const phone = useIsPhone();
  useSwipeViews(phone);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const view = parseView(params.get(PARAM_VIEW));
  const runId = params.get(PARAM_RUN);
  const sheet = params.get(PARAM_SHEET) === "disruptions";

  // the shown plan and board view belong to one day and decision time; a change of either resets them without an effect
  const [shownState, setShownState] = useState<{ day: string | null; clock: number; rank: number | null; view: BoardView }>({ day: null, clock: -1, rank: null, view: "before" });
  const current = shownState.day === dayId && shownState.clock === clock;
  const shownRank = current ? shownState.rank : null;
  const boardView: BoardView = current ? shownState.view : "before";
  const setShownRank = useCallback((rank: number | null) => setShownState((s) => ({ day: dayId, clock, rank, view: s.day === dayId && s.clock === clock ? s.view : "before" })), [dayId, clock]);
  const setBoardView = useCallback((view: BoardView) => setShownState((s) => ({ day: dayId, clock, rank: s.day === dayId && s.clock === clock ? s.rank : null, view })), [dayId, clock]);
  const [airport, setAirport] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [emphasisKey, setEmphasisKey] = useState(0);
  const lastTimelineRef = useRef<Timeline | null>(null);

  // merged into the live URL, so a pending tab navigation is never clobbered by an effect writing the run id
  const setParam = useCallback((p: Record<string, string | number | null>) => router.replace(`${pathname}${withParams(window.location.search, p)}`, { scroll: false }), [router, pathname]);
  const setRunId = useCallback((id: string | null) => setParam({ [PARAM_RUN]: id }), [setParam]);
  const setSheet = useCallback((o: boolean) => setParam({ [PARAM_SHEET]: o ? "disruptions" : null }), [setParam]);

  // the latest run at this day and decision time, when the URL has none
  const runs = useQuery({ queryKey: keys.runs(dayId ?? ""), queryFn: () => api.runs(dayId!), enabled: !!dayId, staleTime: 15_000 });
  useEffect(() => {
    if (runId || !runs.data) return;
    const latest = runs.data.data.filter((r) => r.decision_time === clock).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (latest) setRunId(latest.id);
  }, [runId, runs.data, clock, setRunId]);

  const airportsQ = useQuery({ queryKey: keys.table(dayId ?? "", "airports"), queryFn: () => api.table(dayId!, "airports"), enabled: !!dayId, staleTime: 5 * 60_000 });
  const airports: MapAirport[] = useMemo(() => (airportsQ.data?.data.rows ?? []).map((r) => ({ code: String(r.code), name: String(r.name ?? r.code), lat: Number(r.lat), lon: Number(r.lon), is_hub: Boolean(r.is_hub) })), [airportsQ.data]);
  const airportNames = useMemo(() => new Map(airports.map((a) => [a.code, a.name])), [airports]);

  const runQ = useQuery({ queryKey: keys.run(runId ?? ""), queryFn: () => api.run(runId!), enabled: !!runId });
  const run = runQ.data?.data && runQ.data.data.decision_time === clock ? runQ.data.data : null;
  const shownPlan: Plan | null = useMemo(() => (run && shownRank != null ? run.plans.find((p) => p.rank === shownRank) ?? null : null), [run, shownRank]);
  const { timeline: after } = usePlanTimeline(shownPlan?.actions ?? null);
  const diff = useMemo(() => (timeline && after ? diffTimelines(timeline, after) : null), [timeline, after]);
  const flights = useMemo(() => new Map((timeline?.flights ?? []).map((f) => [f.id, f])), [timeline]);

  // the board leaves a filtered view by itself when the day changes underneath (spec §5.2)
  useEffect(() => {
    if (!timeline) return;
    const prev = lastTimelineRef.current;
    lastTimelineRef.current = timeline;
    if (prev && prev !== timeline && boardView !== "before" && (prev.disruptions.length !== timeline.disruptions.length || prev.committed.count !== timeline.committed.count || prev.clock !== timeline.clock)) {
      setBoardView("before");
      toast("Back to the full day because the day changed.");
    }
  }, [timeline, boardView, setBoardView]);

  const showPlan = (rank: number | null) => {
    setShownRank(rank);
    if (rank != null) {
      setBoardView("changes");
      setEmphasisKey((k) => k + 1);
    }
  };
  const onBoardView = (v: BoardView) => {
    setBoardView(v);
    if (v !== "before" && shownRank == null && run?.plans[0]) setShownRank(run.plans[0].rank ?? null);
    if (v !== "before") setEmphasisKey((k) => k + 1);
  };
  const pulseIds = useMemo(() => {
    if (!timeline) return new Set<string>();
    return new Set(run ? [] : timeline.disruptions.map((d) => d.id));
  }, [timeline, run]);
  const planLabel = shownPlan ? `plan ${shownPlan.rank}` : null;
  const refresh = () => void qc.invalidateQueries();

  if (!dayId && !daysLoading)
    return (
      <EmptyState action={<><Button variant="primary" asChild><Link href="/data">Open the demo day or generate one</Link></Button></>}>
        No operational day is open. Open the demo day, generate one, or import your own on the Data page.
      </EmptyState>
    );
  if (error) return <EmptyState>{error}</EmptyState>;
  if (!timeline || loading)
    return (
      <div className="space-y-5" aria-busy>
        <Skeleton className="h-9 w-[60%]" />
        <Skeleton className="h-4 w-[45%]" />
        <div className="flex gap-8">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-16" />)}</div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]"><Skeleton className="h-[420px]" /><Skeleton className="h-[420px]" /></div>
        <p className="text-[12.5px] text-ivory-3">{state === "connecting" ? "Connecting to the engine…" : "Propagating the day…"}</p>
      </div>
    );

  const boardEl = (
    <Board timeline={timeline} after={shownPlan ? after : null} diff={diff} planLabel={planLabel} view={boardView} onViewChange={onBoardView} clock={clock} airport={airport} onClearAirport={() => setAirport(null)} selectedId={selectedId} onSelect={setSelectedId} filterAtRisk={filter === "at_risk" || filter === "forced_cancellations" || filter === "delayed_flights"} emphasisKey={emphasisKey} />
  );
  const mapEl = (
    <Panel title="Network" aside={<span className="text-ivory-3">{airports.length} airports, {airports.filter((a) => a.is_hub).length} hubs</span>} well bodyClassName="p-1">
      <NetworkMap airports={airports} flights={(boardView !== "before" && after ? after : timeline).flights} disruptions={timeline.disruptions} diff={boardView !== "before" ? diff : null} selected={airport} onSelect={setAirport} pulseIds={pulseIds} />
      {boardView !== "before" && diff && diff.airportDelta.size > 0 && (
        <p className="px-2.5 pb-2 pt-1 text-[12px] text-ivory-2">
          Network change: {[...diff.airportDelta.entries()].sort((a, b) => b[1].before - b[1].after - (a[1].before - a[1].after)).slice(0, 6).map(([c, d]) => `${c} ${d.before} → ${d.after} at risk`).join(", ")}.
        </p>
      )}
    </Panel>
  );
  const disruptionsEl = <DisruptionsPanel timeline={timeline} dayId={dayId!} airportNames={airportNames} onChanged={refresh} sheetOpen={sheet} onSheetOpenChange={setSheet} />;
  const atRiskEl = <AtRiskList timeline={timeline} flights={flights} airport={airport} filter={filter} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); if (view !== "board") setParam({ [PARAM_VIEW]: "board" }); }} />;
  const decisionsEl = <DecisionsList dayId={dayId!} timeline={timeline} clock={clock} onOpenRun={(id, t) => { if (t !== clock) setClock(t); setRunId(id); }} onChanged={refresh} />;
  const plansEl = <PlansSection dayId={dayId!} clock={clock} timeline={timeline} flights={flights} airportNames={airportNames} runId={runId} onRunId={setRunId} shownRank={shownRank} onShownRank={showPlan} onDecided={refresh} />;
  const headlineEl = <Headline timeline={timeline} after={boardView !== "before" ? after : null} planLabel={planLabel} airportNames={airportNames} clock={clock} filter={filter} onFilter={setFilter} />;

  return (
    <div className="space-y-5">
      {/* desktop and tablet: everything on one screen */}
      {!phone && (
      <div className="space-y-5">
        {headlineEl}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">{boardEl}</div>
          <div className="space-y-5">
            {disruptionsEl}
            {atRiskEl}
            {mapEl}
          </div>
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">{plansEl}</div>
          <div>{decisionsEl}</div>
        </div>
      </div>
      )}

      {/* phone: one view at a time */}
      {phone && (
      <div className={cn("space-y-4")}>
        {view === "today" && (
          <>
            {headlineEl}
            {disruptionsEl}
            {atRiskEl}
            {decisionsEl}
            <div className="pb-safe fixed inset-x-0 bottom-14 z-20 border-t border-hairline bg-panel px-4 py-2">
              <Button variant="primary" size="lg" className="w-full" asChild>
                <Link href={`/${withParams(params, { [PARAM_VIEW]: "plans" })}`}>{run ? `See the plans at ${timeline.clock_hhmm}` : "Get a recommendation"}</Link>
              </Button>
            </div>
            <div className="h-14" />
          </>
        )}
        {view === "board" && boardEl}
        {view === "map" && mapEl}
        {view === "plans" && plansEl}
      </div>
      )}
    </div>
  );
}
