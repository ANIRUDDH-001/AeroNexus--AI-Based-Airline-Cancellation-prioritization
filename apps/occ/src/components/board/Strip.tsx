"use client";
import { Check, Pin } from "lucide-react";
import type { TimelineFlight } from "@/lib/api";
import { stripState } from "@/lib/diff";
import type { FlightChange } from "@/lib/diff";
import { cn } from "@/lib/utils";
import { GLOSSARY } from "@/lib/glossary";
import { stripText } from "./useBoardData";

/** One leg on the board. State is carried by fill, a 3 px edge, and a non-colour mark (hatch and strike for
 *  cancels itself, dashed outline for at risk, "+40" for delayed, a check for protected, a pin for committed,
 *  "was VT-IAD" for re-fleeted), and named in the aria-label (spec §5.2). */
export function Strip({ flight, left, width, change, committed, selected, onClick, emphasis }: { flight: TimelineFlight; left: number; width: number; change: FlightChange | null; committed: boolean; selected: boolean; onClick?: () => void; emphasis?: boolean }) {
  const state = change?.kind === "protected" ? "protected" : stripState(flight);
  const text = stripText(flight, width);
  const delayLabel = change ? change.label : flight.delay_min > 0 && state !== "cancels_itself" && state !== "cancelled_by_plan" ? `+${flight.delay_min}` : "";
  const name = (GLOSSARY as Record<string, { label: string }>)[`state_${state}`]?.label ?? state;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${flight.number} ${flight.origin} to ${flight.dest} ${flight.std_hhmm}, ${name}${change ? `, ${change.label}` : ""}`}
      data-state={state}
      style={{ left, width: Math.max(width, 6) }}
      className={cn(
        "absolute top-[5px] flex h-5 items-center gap-1 overflow-hidden rounded-strip border-l-[3px] px-1 text-[11px] leading-5 text-strip-text outline-none",
        "focus-visible:ring-2 focus-visible:ring-amber",
        state === "on_time" && "border-strip-edge bg-strip",
        state === "delayed" && "border-amber bg-strip-delay",
        state === "at_risk" && "border-amber bg-strip-delay [outline:1px_dashed_rgba(240,179,69,.55)] [outline-offset:-1px]",
        state === "cancels_itself" && "border-coral bg-strip-cancel text-coral line-through decoration-coral/60 [background-image:repeating-linear-gradient(135deg,transparent_0_4px,rgba(255,95,82,.16)_4px_6px)]",
        state === "cancelled_by_plan" && "border-ivory-3 bg-strip-cancel text-ivory-2",
        state === "already_happened" && "border-strip-edge bg-strip opacity-55",
        state === "protected" && "border-mint bg-strip",
        change && "ring-1 ring-ivory",
        emphasis && "animate-[emphasis_240ms_ease-out]",
        selected && "ring-2 ring-amber",
      )}
    >
      {committed && <Pin className="size-3 shrink-0 text-ivory" aria-hidden />}
      {state === "protected" && <Check className="size-3 shrink-0 text-mint" aria-hidden />}
      {text && (
        <span className="min-w-0 flex-1 truncate">
          <span className="mono font-medium">{text.split(" ")[0]}</span>
          {text.includes("–") && <span className="opacity-80"> {text.split(" ").slice(1).join(" ")}</span>}
        </span>
      )}
      {delayLabel && width >= 84 && <span className={cn("ml-auto shrink-0 pl-1 text-[10px]", change?.kind === "protected" ? "text-mint" : change?.kind === "cancelled_by_plan" ? "text-ivory-2" : "text-amber")}>{delayLabel}</span>}
    </button>
  );
}
