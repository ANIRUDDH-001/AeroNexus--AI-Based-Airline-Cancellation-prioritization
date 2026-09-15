import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Horizontal bars for a short comparison (policies, days). The highlighted row is amber; the rest ivory-3. */
export function BarList({ items, format = fmt, highlight }: { items: { name: string; value: number; sub?: string }[]; format?: (v: number) => string; highlight?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-1.5">
      {items.map((it) => {
        const hl = it.name === highlight;
        return (
          <div key={it.name} className="grid grid-cols-[minmax(120px,200px)_1fr_90px] items-center gap-3 text-[12.5px]">
            <div className={cn("truncate", hl ? "text-ivory" : "text-ivory-2")}>
              {it.name}
              {it.sub && <span className="ml-1 text-[11px] text-ivory-3">{it.sub}</span>}
            </div>
            <div className="h-4 rounded-[2px] bg-well">
              <div className={cn("h-4 rounded-[2px]", hl ? "bg-amber" : "bg-ivory-3/60")} style={{ width: `${(it.value / max) * 100}%` }} />
            </div>
            <div className={cn("num text-right", hl ? "text-ivory" : "text-ivory-2")}>{format(it.value)}</div>
          </div>
        );
      })}
    </div>
  );
}
