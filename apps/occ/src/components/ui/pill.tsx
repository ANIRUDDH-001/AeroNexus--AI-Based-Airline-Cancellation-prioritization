import * as React from "react";
import { cn } from "@/lib/utils";

/** A state pill. Tones are the four state colours plus ivory for "the engine's own" and neutral for anything
 *  that carries no state. Colour never travels alone: the text names the state. */
export type Tone = "amber" | "coral" | "mint" | "lilac" | "ivory" | "neutral";

const toneCls: Record<Tone, string> = {
  amber: "bg-amber-soft text-amber",
  coral: "bg-coral-soft text-coral",
  mint: "bg-mint-soft text-mint",
  lilac: "bg-lilac-soft text-lilac",
  ivory: "bg-ivory text-graphite",
  neutral: "bg-panel-2 text-ivory-2",
};

export function Pill({ tone = "neutral", children, className, title, outline = false }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string; outline?: boolean }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[2px] text-[11.5px] font-medium leading-4",
        outline ? "border border-hairline-strong bg-transparent text-ivory-2" : toneCls[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small round dot for status lines. */
export function Dot({ tone, pulse = false, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  const bg: Record<Tone, string> = { amber: "bg-amber", coral: "bg-coral", mint: "bg-mint", lilac: "bg-lilac", ivory: "bg-ivory", neutral: "bg-ivory-3" };
  return <span aria-hidden className={cn("inline-block size-[7px] shrink-0 rounded-full", bg[tone], pulse && "animate-pulse", className)} />;
}
