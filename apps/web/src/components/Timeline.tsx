import { useMemo, useState } from "react";
import { hhmm, type TimelineFlight } from "@/lib/api";

/** Rotation timeline (Plan §18.2, page 1): rows = tails, blocks = legs at their *simulated* times.
 *  Plain SVG, no chart library; colours come from the design tokens. */
export function Timeline({ flights, rotations, clock, highlight = [] }: { flights: TimelineFlight[]; rotations: Record<string, string[]>; clock: number; highlight?: string[] }) {
  const [hover, setHover] = useState<TimelineFlight | null>(null);
  const byId = useMemo(() => new Map(flights.map((f) => [f.id, f])), [flights]);
  const tails = useMemo(() => Object.keys(rotations).sort(), [rotations]);
  const hi = useMemo(() => new Set(highlight), [highlight]);

  const T0 = 4 * 60;
  const T1 = 27 * 60;
  const labelW = 72;
  const rowH = 22;
  const width = 1040;
  const plotW = width - labelW - 8;
  const x = (m: number) => labelW + ((Math.max(T0, Math.min(T1, m)) - T0) / (T1 - T0)) * plotW;
  const height = tails.length * rowH + 28;

  const fill = (f: TimelineFlight) => {
    if (f.status === "CANCELLED_FORCED") return "var(--color-bad-soft)";
    if (f.status === "CANCELLED_DECISION") return "var(--color-hover)";
    if (f.delay_min >= 45) return "var(--color-warn-soft)";
    if (f.delay_min > 0) return "#FFF6E8";
    return "var(--color-accent-soft)";
  };
  const stroke = (f: TimelineFlight) => {
    if (hi.has(f.id)) return "var(--color-accent)";
    if (f.status === "CANCELLED_FORCED") return "var(--color-bad)";
    if (f.at_risk) return "var(--color-warn)";
    return "var(--color-border)";
  };

  return (
    <div className="relative overflow-x-auto">
      <svg width={width} height={height} className="block text-[10px]" style={{ fontFamily: "inherit" }}>
        {Array.from({ length: (T1 - T0) / 60 + 1 }, (_, i) => T0 + i * 60).map((m) => (
          <g key={m}>
            <line x1={x(m)} x2={x(m)} y1={18} y2={height - 6} stroke="var(--color-border)" strokeWidth={1} />
            <text x={x(m)} y={12} textAnchor="middle" fill="var(--color-ink-2)">
              {hhmm(m).slice(0, 2)}
            </text>
          </g>
        ))}
        <line x1={x(clock)} x2={x(clock)} y1={14} y2={height - 6} stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="3 3" />
        {tails.map((tail, r) => {
          const y = 22 + r * rowH;
          return (
            <g key={tail}>
              <text x={4} y={y + 14} fill="var(--color-ink-2)" className="font-mono">
                {tail}
              </text>
              {rotations[tail].map((fid) => {
                const f = byId.get(fid);
                if (!f) return null;
                const cancelled = f.status.startsWith("CANCELLED");
                const s = cancelled ? f.std : f.dep ?? f.std;
                const e = cancelled ? f.sta : f.arr ?? f.sta;
                const w = Math.max(3, x(e) - x(s));
                return (
                  <g key={fid} onMouseEnter={() => setHover(f)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
                    <rect x={x(s)} y={y + 3} width={w} height={rowH - 7} rx={3} fill={fill(f)} stroke={stroke(f)} strokeWidth={hi.has(f.id) ? 2 : 1} strokeDasharray={f.status === "CANCELLED_DECISION" ? "3 2" : undefined} />
                    {w > 36 && (
                      <text x={x(s) + 4} y={y + 14} fill={cancelled ? "var(--color-ink-2)" : "var(--color-ink)"} style={{ textDecoration: cancelled ? "line-through" : undefined }}>
                        {f.origin}–{f.dest}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="absolute left-2 top-2 rounded-md border border-border bg-bg px-3 py-2 text-[12px] shadow-[var(--shadow-pop)] max-w-sm pointer-events-none">
          <div className="font-medium">
            {hover.number} {hover.origin}→{hover.dest} · {hover.tail} · {hover.booked_pax} pax
          </div>
          <div className="text-ink-2">
            sched {hover.std_hhmm}–{hover.sta_hhmm}
            {hover.status.startsWith("CANCELLED") ? ` · ${hover.status === "CANCELLED_FORCED" ? "forced cancellation" : "cancelled by plan"}` : ` · actual ${hhmm(hover.dep)}–${hhmm(hover.arr)}${hover.delay_min ? ` (+${hover.delay_min} min)` : ""}`}
          </div>
          {hover.reason && <div className="text-bad mt-1">{hover.reason}</div>}
          {hover.risk_reasons.length > 0 && <div className="text-warn mt-1">{hover.risk_reasons.join("; ")}</div>}
        </div>
      )}
      <div className="flex gap-4 mt-2 text-[11px] text-ink-2">
        <Legend color="var(--color-accent-soft)" label="on time" />
        <Legend color="var(--color-warn-soft)" label="delayed" border="var(--color-warn)" />
        <Legend color="var(--color-bad-soft)" label="forced cancellation" border="var(--color-bad)" />
        <Legend color="var(--color-hover)" label="cancelled by plan" dashed />
        <span>dashed blue line = decision time</span>
      </div>
    </div>
  );
}

function Legend({ color, label, border, dashed }: { color: string; label: string; border?: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color, border: `1px ${dashed ? "dashed" : "solid"} ${border ?? "var(--color-border)"}` }} />
      {label}
    </span>
  );
}
