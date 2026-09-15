"use client";
import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";
import type { Disruption, TimelineFlight } from "@/lib/api";
import type { Diff } from "@/lib/diff";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/overlay";
import { disruptionName } from "@/components/disruptions/describe";

export type MapAirport = { code: string; name: string; lat: number; lon: number; is_hub: boolean };

const W = 400;
const H = 300;
const HALO = 9; // one fixed halo for every lit airport, so blooms never merge into a wash (spec §5.3)
const HALO_DISRUPTED = 18;
const MAX_LABELS = 14; // beyond this the panel is a wall of text; the rest keep their dot, tooltip and aria-label

/** India at night (spec §5.3): the network as arcs, airports as amber lights sized by risk, disrupted airports
 *  with a lilac halo whose pulse is driven by one clock for the whole map. Situational awareness, not the
 *  argument: it never grows beyond its panel. */
export function NetworkMap({ airports, flights, disruptions, diff, selected, onSelect, pulseIds, height = H }: { airports: MapAirport[]; flights: TimelineFlight[]; disruptions: Disruption[]; diff: Diff | null; selected: string | null; onSelect: (code: string | null) => void; pulseIds: Set<string>; height?: number }) {
  const [geo, setGeo] = useState<FeatureCollection | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  useEffect(() => {
    // boundaries as depicted by the Government of India (Survey of India): built from Natural Earth's India
    // point-of-view dataset by scripts/build-geo.mjs, never from the default de-facto lines
    fetch("/geo/south-asia.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("map data"))))
      .then(setGeo)
      .catch(() => setGeoFailed(true));
  }, []);

  // one clock for every pulse: each halo starts its CSS animation at the same global phase, so however many
  // disruptions there are and whenever they were added, the map breathes as one unit (reduced motion: static)
  // the phase is written on the SVG as a CSS variable when it mounts; every halo's animation-delay reads it
  const alignPhase = (el: SVGSVGElement | null) => {
    if (el) el.style.setProperty("--phase", `${-(performance.now() % 2400)}ms`);
  };

  const proj = useMemo(() => geoMercator().fitExtent([[18, 12], [W - 18, height - 12]], { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[66.5, 5.5], [66.5, 37.6], [97.8, 37.6], [97.8, 5.5], [66.5, 5.5]]] } }] } as FeatureCollection), [height]);
  const path = useMemo(() => geoPath(proj), [proj]);
  const byCode = useMemo(() => new Map(airports.map((a) => [a.code, a])), [airports]);
  const pt = (code: string): [number, number] | null => {
    const a = byCode.get(code);
    if (!a) return null;
    const p = proj([a.lon, a.lat]);
    return p ? [p[0], p[1]] : null;
  };

  const routes = useMemo(() => {
    const m = new Map<string, { a: string; b: string; n: number; risk: number; cancelled: number }>();
    for (const f of flights) {
      const key = [f.origin, f.dest].sort().join("-");
      const r = m.get(key) ?? { a: f.origin, b: f.dest, n: 0, risk: 0, cancelled: 0 };
      r.n += 1;
      if (f.at_risk) r.risk += 1;
      if (f.status === "CANCELLED_FORCED" || f.status === "CANCELLED_DECISION") r.cancelled += 1;
      m.set(key, r);
    }
    return [...m.values()];
  }, [flights]);
  const perAirport = useMemo(() => {
    const m = new Map<string, { risk: number; cancelled: number; n: number }>();
    for (const f of flights) {
      for (const c of [f.origin, f.dest]) {
        const r = m.get(c) ?? { risk: 0, cancelled: 0, n: 0 };
        r.n += 1;
        if (f.at_risk || f.status === "CANCELLED_FORCED") r.risk += 1;
        if (f.status === "CANCELLED_FORCED" || f.status === "CANCELLED_DECISION") r.cancelled += 1;
        m.set(c, r);
      }
    }
    return m;
  }, [flights]);
  const disrupted = useMemo(() => new Map(disruptions.filter((d) => byCode.has(d.target)).map((d) => [d.target, d])), [disruptions, byCode]);
  // which airports get a label: disrupted first, then hubs, then by risk, capped; the selected one always
  const labelled = useMemo(() => {
    const score = (a: MapAirport) => (disrupted.has(a.code) ? 1_000_000 : 0) + (a.is_hub ? 100_000 : 0) + (perAirport.get(a.code)?.risk ?? 0);
    const top = [...airports].filter((a) => a.is_hub || (perAirport.get(a.code)?.risk ?? 0) > 0 || disrupted.has(a.code)).sort((x, y) => score(y) - score(x)).slice(0, MAX_LABELS).map((a) => a.code);
    return new Set(selected ? [...top, selected] : top);
  }, [airports, disrupted, perAirport, selected]);
  const aogAt = useMemo(() => {
    const tails = new Set(disruptions.filter((d) => d.type === "AOG").map((d) => d.target));
    const at = new Map<string, string[]>();
    for (const t of tails) {
      const first = flights.filter((f) => f.tail === t).sort((a, b) => a.std - b.std)[0];
      if (first) at.set(first.origin, [...(at.get(first.origin) ?? []), t]);
    }
    return at;
  }, [disruptions, flights]);

  const arc = (a: string, b: string) => {
    const p1 = pt(a);
    const p2 = pt(b);
    if (!p1 || !p2) return null;
    const mx = (p1[0] + p2[0]) / 2;
    const my = (p1[1] + p2[1]) / 2;
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const d = Math.hypot(dx, dy) || 1;
    const k = 0.16 * d;
    return `M${p1[0]},${p1[1]} Q${mx - (dy / d) * k},${my + (dx / d) * k} ${p2[0]},${p2[1]}`;
  };

  if (geoFailed)
    return (
      <div className="p-3 text-[12.5px] text-ivory-2">
        Map data did not load. Airports today:{" "}
        {airports.map((a) => (
          <span key={a.code} className="mono mr-2">
            {a.code}
          </span>
        ))}
      </div>
    );

  return (
    <svg ref={alignPhase} viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full" role="img" aria-label="Network map: airports lit by risk, routes as arcs, disrupted airports with a halo">
      <defs>
        <radialGradient id="ax-halo">
          <stop offset="0" stopColor="#F0B345" stopOpacity="0.5" />
          <stop offset="1" stopColor="#F0B345" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ax-halo-lilac">
          <stop offset="0" stopColor="#B39BF5" stopOpacity="0.32" />
          <stop offset="1" stopColor="#B39BF5" stopOpacity="0" />
        </radialGradient>
      </defs>
      {geo?.features.map((f, i) => (
        <path key={i} d={path(f) ?? undefined} fill={f.properties?.name === "India" ? "#2B2C34" : "#1F2026"} stroke="rgba(239,234,224,.28)" strokeWidth={0.7} />
      ))}
      {routes.map((r) => {
        const d = arc(r.a, r.b);
        if (!d) return null;
        const bad = r.cancelled > 0;
        const risk = r.risk > 0;
        return <path key={`${r.a}-${r.b}`} d={d} fill="none" stroke={bad ? "#FF5F52" : risk ? "#F0B345" : "#EFEAE0"} strokeOpacity={bad ? 0.7 : risk ? Math.min(0.85, 0.5 + r.risk * 0.1) : 0.14} strokeWidth={Math.min(2.4, 0.6 + r.n * 0.15)} />;
      })}
      {airports.map((a) => {
        const p = pt(a.code);
        if (!p) return null;
        const s = perAirport.get(a.code);
        const risk = s?.risk ?? 0;
        const r = 2 + Math.min(4, Math.sqrt(risk));
        const dis = disrupted.get(a.code);
        const sel = selected === a.code;
        const delta = diff?.airportDelta.get(a.code);
        const lit = risk > 0 || a.is_hub;
        return (
          <g key={a.code}>
            {dis && <circle cx={p[0]} cy={p[1]} r={HALO_DISRUPTED} fill="url(#ax-halo-lilac)" className={pulseIds.has(dis.id) ? "animate-[halo_2.4s_ease-in-out_infinite]" : undefined} style={pulseIds.has(dis.id) ? { animationDelay: "var(--phase, 0ms)" } : { opacity: 0.85 }} />}
            {lit && <circle cx={p[0]} cy={p[1]} r={HALO} fill="url(#ax-halo)" />}
            <circle cx={p[0]} cy={p[1]} r={r} fill={lit ? "#F0B345" : "#A8A399"} stroke={sel ? "#EFEAE0" : "none"} strokeWidth={sel ? 1.5 : 0} />
            {aogAt.get(a.code)?.map((t, i) => <rect key={t} x={p[0] + r + 2 + i * 5} y={p[1] - r - 5} width={3.5} height={3.5} fill="#FF5F52" />)}
            {labelled.has(a.code) && (
              <text x={p[0] + r + 4} y={p[1] + 3.5} fontSize={9.5} fontWeight={600} fill={a.is_hub ? "#EFEAE0" : "#A8A399"} fontFamily="inherit">
                {a.code}
                {risk > 0 && (
                  <tspan fill="#F0B345" fontWeight={500}>
                    {" "}
                    {risk}
                  </tspan>
                )}
                {delta && (
                  <tspan fill={delta.after < delta.before ? "#58D08F" : "#FF5F52"} fontWeight={500}>
                    {" "}
                    {delta.after < delta.before ? "−" : "+"}
                    {Math.abs(delta.after - delta.before)}
                  </tspan>
                )}
              </text>
            )}
            {dis && (
              <text x={p[0] + r + 4} y={p[1] + 14} fontSize={8.5} fill="#B39BF5" fontFamily="inherit">
                {disruptionName(dis.type).toLowerCase()}
              </text>
            )}
            {/* hit target above every layer, so taps never land on a halo */}
            <Tooltip content={`${a.name} (${a.code}): ${s?.n ?? 0} flights today, ${risk} at risk, ${s?.cancelled ?? 0} cancelled${dis ? `. ${disruptionName(dis.type)} in effect.` : ""}`}>
              <circle cx={p[0]} cy={p[1]} r={16} fill="transparent" className={cn("cursor-pointer")} onClick={() => onSelect(sel ? null : a.code)} tabIndex={0} role="button" aria-label={`${a.name}, ${risk} at risk`} />
            </Tooltip>
          </g>
        );
      })}
    </svg>
  );
}
