"use client";
import { fmt } from "@/lib/format";

/** Sampled futures on one axis: every dot is one simulated future's network impact, the tick is the mean.
 *  Raw samples, honestly shown; no bars, no percentages (spec §6). */
export function FuturesStrip({ rows, height = 24 }: { rows: { label: string; values: number[]; mean: number; tone: "ivory" | "muted" }[]; height?: number }) {
  const all = rows.flatMap((r) => (r.values.length ? r.values : [r.mean]));
  if (!all.length) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min || 1) * 0.06;
  const lo = min - pad;
  const hi = max + pad;
  const L = 120;
  const W = 520;
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - 12);
  const h = rows.length * height + 20;
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="block w-full max-w-[560px]" role="img" aria-label="Sampled futures per plan; each dot is one future, the tick is the mean">
      {[0, 0.5, 1].map((t) => {
        const v = lo + t * (hi - lo);
        return (
          <g key={t}>
            <line x1={x(v)} x2={x(v)} y1={4} y2={h - 16} stroke="rgba(255,255,255,.08)" />
            <text x={x(v)} y={h - 4} textAnchor="middle" fontSize={9.5} fill="#6C6862" fontFamily="inherit">
              {fmt(v)}
            </text>
          </g>
        );
      })}
      {rows.map((r, i) => {
        const y = 6 + i * height + height / 2;
        const c = r.tone === "ivory" ? "#EFEAE0" : "#6C6862";
        return (
          <g key={i}>
            <text x={0} y={y + 3.5} fontSize={11} fill={r.tone === "ivory" ? "#EFEAE0" : "#A8A399"} fontFamily="inherit">
              {r.label}
            </text>
            {r.values.map((v, j) => (
              <circle key={j} cx={x(v)} cy={y + ((j % 3) - 1) * 3} r={2.4} fill={c} fillOpacity={0.6} />
            ))}
            <line x1={x(r.mean)} x2={x(r.mean)} y1={y - 8} y2={y + 8} stroke={r.tone === "ivory" ? "#F0B345" : "#A8A399"} strokeWidth={2} />
          </g>
        );
      })}
    </svg>
  );
}
