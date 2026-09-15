"use client";
import { useState } from "react";
import { useDay } from "@/hooks/useDay";
import { hhmm } from "@/lib/format";
import { term } from "@/lib/glossary";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Slider } from "@/components/ui/controls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const QUICK = [300, 360, 480, 720, 1020];

/** The decision time, labelled as such (spec §4). The popover carries the one sentence that teaches the model:
 *  everything before this time has already happened; the engine decides from here. */
export function ClockControl({ compact = false }: { compact?: boolean }) {
  const { clock, setClock } = useDay();
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? clock;
  const t = term("decision_time");
  return (
    <Popover onOpenChange={(o) => !o && setDraft(null)}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-8 items-center gap-2 rounded-control px-2 hover:bg-panel-2" aria-label={`Decision time ${hhmm(clock)}`}>
          {!compact && <span className="text-[12px] text-ivory-2">Decision time</span>}
          <span className={cn("mono font-semibold text-ivory", compact ? "text-[14px]" : "text-[15px]")}>{hhmm(clock)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] space-y-3">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-semibold text-ivory">Decision time</span>
            <span className="mono text-[18px] font-semibold text-ivory">{hhmm(shown)}</span>
          </div>
          <Slider value={shown} onChange={setDraft} min={0} max={1425} step={15} ariaLabel="Decision time" className="mt-2" />
          <div className="mt-1 flex justify-between text-[10.5px] text-ivory-3">
            {["00", "06", "12", "18", "24"].map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => setDraft(q)} className={cn("mono rounded-full border px-2 py-[2px] text-[11.5px]", shown === q ? "border-ivory bg-ivory text-graphite" : "border-hairline-strong text-ivory-2 hover:text-ivory")}>
              {hhmm(q)}
            </button>
          ))}
        </div>
        <p className="text-[12px] leading-snug text-ivory-2">{t.short}</p>
        <div className="flex justify-end gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={draft == null || draft === clock}
            onClick={() => {
              if (draft != null) setClock(draft);
              setDraft(null);
            }}
          >
            Set {draft != null && draft !== clock ? hhmm(draft) : "time"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
