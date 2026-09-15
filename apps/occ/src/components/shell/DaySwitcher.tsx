"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useDay } from "@/hooks/useDay";
import { dayDetail, dayTitle, isSynthetic } from "@/lib/day";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";

/** Which operational day is open. Named for people ("Medium synthetic day"), with the provenance in the popover. */
export function DaySwitcher({ compact = false }: { compact?: boolean }) {
  const { day, days, daysLoading, setDay } = useDay();
  const title = day ? dayTitle(day) : daysLoading ? "Loading days" : "No day open";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-control px-2 text-[12.5px] hover:bg-panel-2" aria-label="Operational day">
          <span className="truncate text-ivory">{compact && day ? title.replace(" synthetic day", "") : title}</span>
          {!compact && day && day.summary?.flights != null && <span className="text-ivory-3">{String(day.summary.flights)} flights</span>}
          <ChevronDown className="size-3.5 shrink-0 text-ivory-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-1.5">
        {day && (
          <div className="border-b border-hairline px-2 pb-2 pt-1">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ivory">
              {dayTitle(day)}
              {isSynthetic(day) && <Pill tone="neutral">Synthetic</Pill>}
            </div>
            <div className="mt-0.5 text-[12px] text-ivory-2">{dayDetail(day)}</div>
          </div>
        )}
        <div className="max-h-[300px] overflow-y-auto py-1">
          {days.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setDay(r.id)}
              className={cn("flex w-full flex-col items-start rounded-[4px] px-2 py-1.5 text-left hover:bg-ivory-soft", r.id === day?.id && "bg-ivory-soft")}
            >
              <span className="text-[13px] text-ivory">{dayTitle(r)}</span>
              <span className="text-[11.5px] text-ivory-3">{dayDetail(r)}</span>
            </button>
          ))}
          {!days.length && <div className="px-2 py-2 text-[12.5px] text-ivory-2">{daysLoading ? "Loading…" : "No operational day exists yet."}</div>}
        </div>
        <div className="border-t border-hairline px-2 pt-2 text-[12.5px]">
          <Link href="/data">Manage days</Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
