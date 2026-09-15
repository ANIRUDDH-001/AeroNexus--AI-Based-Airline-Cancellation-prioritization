"use client";
import { useEffect, useRef, useState } from "react";
import type { Timeline } from "@/lib/api";
import { fmt, hhmm } from "@/lib/format";
import { GLOSSARY, term } from "@/lib/glossary";
import { Define } from "@/components/ui/overlay";
import { describeDisruption } from "@/components/disruptions/describe";
import { cn } from "@/lib/utils";

type Kpi = { key: keyof typeof GLOSSARY; value: number; tone?: "amber" | "coral" };

/** The headline sentence, the disruption line, the decision-time sentence, the six KPIs (spec §5.1). */
export function Headline({ timeline, after, planLabel, airportNames, clock, filter, onFilter }: { timeline: Timeline; after: Timeline | null; planLabel: string | null; airportNames: Map<string, string>; clock: number; filter: string | null; onFilter: (k: string | null) => void }) {
  const view = after ?? timeline;
  const s = view.summary;
  const forced = s.forced_cancellations;
  // a brief wash on the decision-time sentence when the clock moves, so the reader learns what moving it means
  const [flashClock, setFlashClock] = useState<number | null>(null);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = clock;
      return;
    }
    if (seen.current === clock) return;
    seen.current = clock;
    const id = setTimeout(() => setFlashClock(null), 700);
    queueMicrotask(() => setFlashClock(clock));
    return () => clearTimeout(id);
  }, [clock]);
  const flash = flashClock === clock;

  const headline =
    forced > 0
      ? `${after ? `With ${planLabel ?? "the plan"}, ` : "If nobody acts, "}${n(forced)} flight${forced > 1 ? "s" : ""} cancel${forced > 1 ? "" : "s"} ${forced > 1 ? "themselves" : "itself"} today and ${n(s.stranded_overnight)} passengers are stranded overnight.`
      : s.at_risk > 0
        ? `${after ? `With ${planLabel ?? "the plan"}, ` : ""}${n(s.at_risk)} flights are at risk today; none has to cancel yet.`
        : "The day is running to plan.";

  const departed = timeline.flights.filter((f) => f.status === "PAST").length;
  const kpis: Kpi[] = [
    { key: "at_risk", value: s.at_risk, tone: s.at_risk ? "amber" : undefined },
    { key: "forced_cancellations", value: s.forced_cancellations, tone: s.forced_cancellations ? "coral" : undefined },
    { key: "delayed_flights", value: s.delayed_flights, tone: s.delayed_flights ? "amber" : undefined },
    { key: "misconnects", value: s.misconnects },
    { key: "stranded_overnight", value: s.stranded_overnight, tone: s.stranded_overnight ? "coral" : undefined },
    { key: "standby_used", value: s.standby_used },
  ];
  return (
    <section>
      <h1 className="headline max-w-[26ch] text-[24px] text-ivory md:text-[28px] xl:text-[34px]">{renderWithNums(headline)}</h1>
      <p className="mt-2 max-w-[90ch] text-[13px] text-ivory-2">
        {timeline.disruptions.length ? timeline.disruptions.map((d) => describeDisruption(d, airportNames)).join(". ") + ". " : "No disruptions on this day. "}
        <span className={cn("rounded-[3px] transition-colors duration-700", flash && "bg-ivory-soft")}>
          <Define short={GLOSSARY.decision_time.short} long={GLOSSARY.decision_time.long}>
            {n(departed)} flights have already departed; {n(timeline.flights.length - departed)} remain under consideration from {hhmm(clock)}.
          </Define>
        </span>
        {timeline.committed.count > 0 && ` ${timeline.committed.count} decision${timeline.committed.count > 1 ? "s" : ""} already committed today.`}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 md:flex md:flex-wrap md:gap-x-8">
        {kpis.map((k) => {
          const t = term(k.key);
          const on = filter === k.key;
          const filterable = k.key === "at_risk" || k.key === "forced_cancellations" || k.key === "delayed_flights";
          return (
            <button key={k.key} type="button" disabled={!filterable} onClick={() => onFilter(on ? null : k.key)} className={cn("rounded-control text-left", filterable && "cursor-pointer hover:bg-ivory-soft", on && "bg-ivory-soft ring-1 ring-hairline-strong", "-mx-1.5 px-1.5 py-1")} aria-pressed={filterable ? on : undefined}>
              <div className={cn("num text-[22px] font-semibold leading-none", k.tone === "amber" ? "text-amber" : k.tone === "coral" ? "text-coral" : "text-ivory")}>{fmt(k.value)}</div>
              <div className="mt-1 text-[12px] text-ivory-2">
                <Define short={t.short} long={t.long}>
                  {t.label}
                </Define>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const n = (v: number) => fmt(v);
/** Numbers inside the sentence get tabular figures so a change in value does not jitter the letters around it. */
function renderWithNums(s: string) {
  return s.split(/(\d[\d,]*)/g).map((part, i) => (/^\d/.test(part) ? <span key={i} className="num">{part}</span> : part));
}
