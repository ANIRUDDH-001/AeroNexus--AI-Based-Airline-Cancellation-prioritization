"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, X } from "lucide-react";
import type { Timeline, TimelineFlight } from "@/lib/api";
import type { Diff } from "@/lib/diff";
import { hhmm } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import { useIsTouch } from "@/hooks/useIsTouch";
import { Panel } from "@/components/ui/panel";
import { Segmented, Switch, Input } from "@/components/ui/controls";
import { HoverCard, Sheet } from "@/components/ui/overlay";
import { Pill } from "@/components/ui/pill";
import { Strip } from "./Strip";
import { StripCard } from "./StripCard";
import { useBoardData, windowRange, type BoardView, type Window } from "./useBoardData";
import { describeDisruption, disruptionName } from "@/components/disruptions/describe";

const TAIL_W = 96;
const ROW_H = 30;
const ROW_H_TOUCH = 36;

/** The rotations board (spec §5.2): one row per tail, strips per leg, the amber now-line, the shaded past,
 *  weather bands on the axis, three views (if nobody acts / with plan / changes only), a hover card per strip. */
export function Board({
  timeline,
  after,
  diff,
  planLabel,
  view,
  onViewChange,
  clock,
  airport,
  onClearAirport,
  selectedId,
  onSelect,
  filterAtRisk,
  emphasisKey,
}: {
  timeline: Timeline;
  after: Timeline | null;
  diff: Diff | null;
  planLabel: string | null;
  view: BoardView;
  onViewChange: (v: BoardView) => void;
  clock: number;
  airport: string | null;
  onClearAirport: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filterAtRisk: boolean;
  emphasisKey: number;
}) {
  const touch = useIsTouch();
  const [win, setWin] = useState<Window>(touch ? "6h" : "day");
  const [query, setQuery] = useState("");
  const [onlyAtRisk, setOnlyAtRisk] = useState(false);
  const [sheetFlight, setSheetFlight] = useState<TimelineFlight | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canvasW, setCanvasW] = useState(900);
  const rowH = touch ? ROW_H_TOUCH : ROW_H;

  const { rows, byId, disruptions } = useBoardData(timeline, after, diff, { query, onlyAtRisk: onlyAtRisk || filterAtRisk, view, airport });
  const [t0, t1] = windowRange(win, clock);
  const committed = useMemo(() => new Set(timeline.committed.cancelled.concat(timeline.committed.swaps, Object.keys(timeline.committed.delays))), [timeline.committed]);

  // the canvas is as wide as the panel for the full day; narrower windows zoom in and scroll horizontally
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasW(Math.max(320, el.clientWidth - TAIL_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // narrower windows zoom the lane past the panel width and scroll horizontally
  const zoom = win === "day" ? 1 : win === "12h" ? 1.6 : 2.4;
  const laneW = canvasW * zoom;
  const pxPerMin = laneW / (t1 - t0);
  const x = (m: number) => (m - t0) * pxPerMin;

  // scroll the window so the decision time sits a third in
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (win === "day") {
      el.scrollLeft = 0;
      return;
    }
    const target = (clock - t0) * pxPerMin - (el.clientWidth - TAIL_W) / 3;
    el.scrollLeft = Math.max(0, target);
  }, [win, clock, t0, pxPerMin]);

  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 8 });

  const ticks = useMemo(() => {
    const step = win === "6h" ? 30 : win === "12h" ? 60 : 120;
    const out: number[] = [];
    for (let m = Math.ceil(t0 / step) * step; m <= t1; m += step) out.push(m);
    return out;
  }, [t0, t1, win]);

  const weather = disruptions.filter((d) => d.type !== "AOG" && d.type !== "CREW_UNAVAILABLE" && d.type !== "FLIGHT_DELAY");
  const changeCount = diff?.changes.length ?? 0;

  const open = (f: TimelineFlight) => {
    onSelect(f.id === selectedId ? null : f.id);
    if (touch) {
      setSheetFlight(f);
      setSheetOpen(true);
    }
  };

  return (
    <Panel
      title="Rotations"
      aside={
        <>
          <span className="hidden text-ivory-3 lg:inline">
            {rows.length} of {Object.keys(timeline.rotations).length} tails, sorted by risk
          </span>
          {airport && (
            <button type="button" onClick={onClearAirport} className="inline-flex items-center gap-1 rounded-full border border-hairline-strong px-2 py-[2px] text-[11.5px] text-ivory hover:bg-ivory-soft">
              {airport} <X className="size-3" />
            </button>
          )}
        </>
      }
      bodyClassName="p-0"
    >
      {/* sticky controls: the way out of any view is always on screen */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
        <Segmented<BoardView>
          ariaLabel="Board view"
          value={view}
          onChange={onViewChange}
          size="sm"
          options={[
            { value: "before", label: "If nobody acts" },
            { value: "after", label: after && planLabel ? `With ${planLabel}` : "With plan" },
            { value: "changes", label: "Changes only" },
          ]}
        />
        <Segmented<Window> ariaLabel="Time window" value={win} onChange={setWin} size="sm" options={[{ value: "day", label: "Day" }, { value: "12h", label: "12 h" }, { value: "6h", label: "6 h" }]} />
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ivory-3" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tail or flight" aria-label="Filter tails" className="h-7 w-[150px] pl-7 text-[12px]" />
        </div>
        <Switch checked={onlyAtRisk} onChange={setOnlyAtRisk} label={<span className="text-[12px] text-ivory-2">Only at risk</span>} />
      </div>
      {view === "changes" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-ivory-soft px-3 py-1.5 text-[12.5px]">
          {diff ? (
            <span>
              Showing the {changeCount} flight{changeCount === 1 ? "" : "s"} {planLabel ?? "the plan"} changes on {diff.tails.size} tail{diff.tails.size === 1 ? "" : "s"}.
            </span>
          ) : (
            <span>Pick a plan below to see what it changes.</span>
          )}
          <button type="button" onClick={() => onViewChange("before")} className="rounded-control border border-hairline-strong px-2 py-0.5 text-[12px] font-semibold text-ivory hover:bg-panel-2">
            Show all
          </button>
        </div>
      )}

      <div ref={scrollRef} data-hscroll className="scroll-thin relative max-h-[520px] overflow-auto rounded-b-panel bg-well">
        <div style={{ width: TAIL_W + laneW }} className="relative">
          {/* axis with weather bands */}
          <div className={cn("sticky top-0 z-[3] flex border-b border-hairline bg-well", weather.length ? "h-11" : "h-7")}>
            <div className="sticky left-0 z-[4] w-[96px] shrink-0 bg-well" />
            <div className="relative flex-1">
              {weather.map((d, i) => {
                const end = d.end_nominal ?? DAY_END_MIN;
                const left = x(Math.max(d.start, t0));
                return (
                  <div key={d.id} title={describeDisruption(d)} className="absolute top-1 h-[14px]" style={{ left, width: Math.max(2, x(Math.min(end, t1)) - left), zIndex: 10 - i }}>
                    <div className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-lilac/70" />
                    <span className="absolute left-0 top-0 whitespace-nowrap text-[10px] leading-[11px] text-lilac">
                      {disruptionName(d.type)} at {d.target} {hhmm(d.start)}–{d.end_nominal == null ? "rest of day" : `${hhmm(d.end_nominal)}${d.end_distribution ? " ±" : ""}`}
                    </span>
                  </div>
                );
              })}
              {ticks.map((m) => (
                <span key={m} className={cn("mono absolute -translate-x-1/2 text-[10.5px] text-ivory-3", weather.length ? "top-[24px]" : "top-1.5")} style={{ left: x(m) }}>
                  {hhmm(m)}
                </span>
              ))}
            </div>
          </div>

          {/* rows */}
          <div style={{ height: virtual.getTotalSize() }} className="relative">
            {/* the realised past, then the decision-time line */}
            <div className="pointer-events-none absolute inset-y-0 z-[1] bg-ivory-soft" style={{ left: TAIL_W, width: Math.max(0, x(Math.min(clock, t1)) - x(t0)) }}>
              <span className="absolute bottom-1 right-2 text-[10px] text-ivory-3">already happened</span>
            </div>
            {clock >= t0 && clock <= t1 && (
              <div className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-amber shadow-[0_0_12px_rgba(240,179,69,.6)]" style={{ left: TAIL_W + x(clock) }}>
                <span className="absolute -top-0 left-1.5 whitespace-nowrap text-[10.5px] font-semibold text-amber">{hhmm(clock)} decision time</span>
              </div>
            )}
            {virtual.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div key={row.tail} className="absolute left-0 flex w-full border-b border-hairline" style={{ top: vi.start, height: vi.size }}>
                  <div className={cn("sticky left-0 z-[2] flex w-[96px] shrink-0 items-center gap-1.5 bg-well pl-2.5 text-[11.5px]", row.aog ? "text-coral" : "text-ivory-2")} title={row.aog ? "Aircraft on ground" : row.forced > 0 ? `${row.forced} leg${row.forced === 1 ? "" : "s"} cancel${row.forced === 1 ? "s" : ""} itself` : undefined}>
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", row.aog || row.forced > 0 ? "bg-coral" : "bg-transparent")} />
                    <span className="flex flex-col leading-[11px]">
                      <span className="mono">{row.tail}</span>
                      {row.aog && <span className="text-[9px] leading-[10px]">on ground</span>}
                    </span>
                  </div>
                  <div className="relative flex-1">
                    {row.legs.map((f) => {
                      const end = (f.arr ?? f.sta) as number;
                      const start = (f.dep ?? f.std) as number;
                      if (end < t0 || start > t1) return null;
                      const left = x(Math.max(start, t0));
                      const width = x(Math.min(end, t1)) - left;
                      const change = diff?.byId.get(f.id) ?? null;
                      const strip = <Strip key={f.id} flight={f} left={left} width={width} change={view === "before" ? null : change} committed={committed.has(f.id)} selected={selectedId === f.id} onClick={() => open(f)} emphasis={view !== "before" && !!change && emphasisKey > 0} />;
                      if (touch) return strip;
                      return (
                        <HoverCard key={f.id} content={<StripCard flight={f} change={view === "before" ? null : change} committed={committed.has(f.id)} />} side="top">
                          {strip}
                        </HoverCard>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-ivory-3">No tails match.</div>}
          </div>
        </div>
      </div>

      <Legend />

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title={sheetFlight ? sheetFlight.number : "Flight"} width={420}>
        {sheetFlight && <StripCard flight={byId.get(sheetFlight.id) ?? sheetFlight} change={view === "before" ? null : (diff?.byId.get(sheetFlight.id) ?? null)} committed={committed.has(sheetFlight.id)} />}
      </Sheet>
    </Panel>
  );
}

const DAY_END_MIN = 27 * 60;

function Legend() {
  const items: { key: keyof typeof GLOSSARY; cls: string }[] = [
    { key: "state_on_time", cls: "border-strip-edge bg-strip" },
    { key: "state_delayed", cls: "border-amber bg-strip-delay" },
    { key: "state_at_risk", cls: "border-amber bg-strip-delay [outline:1px_dashed_rgba(240,179,69,.55)] [outline-offset:-1px]" },
    { key: "state_cancels_itself", cls: "border-coral bg-strip-cancel [background-image:repeating-linear-gradient(135deg,transparent_0_3px,rgba(255,95,82,.25)_3px_5px)]" },
    { key: "state_cancelled_by_plan", cls: "border-ivory-3 bg-strip-cancel" },
    { key: "state_protected", cls: "border-mint bg-strip" },
    { key: "state_committed", cls: "border-strip-edge bg-strip" },
    { key: "state_already_happened", cls: "border-strip-edge bg-strip opacity-55" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline px-3 py-2 text-[11px] text-ivory-2">
      {items.map((i) => (
        <span key={i.key} className="inline-flex items-center gap-1.5" title={GLOSSARY[i.key].short}>
          <i aria-hidden className={cn("inline-block h-3 w-4 rounded-strip border-l-[3px]", i.cls)} />
          {GLOSSARY[i.key].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5" title="An airport disruption in effect across these hours">
        <i aria-hidden className="inline-block h-[3px] w-4 rounded-full bg-lilac/70" />
        weather or airport disruption
      </span>
      <Pill tone="neutral" className="ml-auto hidden md:inline-flex">hover a strip for its story</Pill>
    </div>
  );
}
