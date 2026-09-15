import type { Disruption } from "@/lib/api";
import { hhmm } from "@/lib/format";

/** Plain names for the engine's disruption types (spec §5.4). */
export const DISRUPTION_TYPES = [
  { value: "LVP", label: "Fog / low visibility", target: "airport" },
  { value: "AIRPORT_CAPACITY", label: "Capacity cut", target: "airport" },
  { value: "ATC_FLOW", label: "ATC flow restriction", target: "airport" },
  { value: "CLOSURE", label: "Airport closed", target: "airport" },
  { value: "AOG", label: "Aircraft on ground", target: "tail" },
  { value: "CREW_UNAVAILABLE", label: "Crews unavailable", target: "airport" },
  { value: "FLIGHT_DELAY", label: "Known delay", target: "flight" },
] as const;

export type DisruptionType = (typeof DISRUPTION_TYPES)[number]["value"];

export function disruptionName(type: string): string {
  return DISRUPTION_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function targetKind(type: string): "airport" | "tail" | "flight" {
  return DISRUPTION_TYPES.find((t) => t.value === type)?.target ?? "airport";
}

/** The severity in words: "45% of normal capacity", "3 crews", "90 min". */
function severityWords(sev: Record<string, unknown> | undefined): string {
  const s = sev ?? {};
  const bits: string[] = [];
  if (s.capacity_fraction != null) bits.push(`${Math.round(Number(s.capacity_fraction) * 100)}% of normal capacity`);
  if (s.rate_per_hour != null) bits.push(`${s.rate_per_hour} movements per hour`);
  if (s.n_crews != null) bits.push(`${s.n_crews} crews`);
  if (s.delay_min != null) bits.push(`${s.delay_min} min`);
  if (Array.isArray(s.requires) && s.requires.length) bits.push(`${(s.requires as string[]).join("/")} required`);
  return bits.join(", ");
}

function windowWords(d: Pick<Disruption, "start" | "end_nominal" | "end_distribution">): string {
  const end = d.end_nominal == null ? "the rest of the day" : `${d.end_distribution ? "about " : ""}${hhmm(d.end_nominal)}`;
  return `from ${hhmm(d.start)} to ${end}${d.end_distribution ? " (end time uncertain)" : ""}`;
}

/** One sentence: "Fog at Delhi from 05:00 to about 09:30 (end time uncertain): 45% of normal capacity". */
export function describeDisruption(d: Disruption, airportNames?: Map<string, string>): string {
  const where = targetKind(d.type) === "airport" ? `at ${airportNames?.get(d.target) ?? d.target}` : d.target;
  const sev = severityWords(d.severity);
  return `${disruptionName(d.type)} ${where} ${windowWords(d)}${sev ? `: ${sev}` : ""}`;
}

/** The compact spec string the API accepts (parse_spec in aeronexus_datagen.disruptions). */
export function toSpec(input: { type: DisruptionType; target: string; start: number; end: number | null; capacity?: number; rate?: number; crews?: number; delay?: number }): string {
  const dur = input.end == null ? "" : Math.max(15, input.end - input.start);
  switch (input.type) {
    case "LVP":
      return `fog:${input.target}:${input.start}:${dur || 240}:${input.capacity ?? 0.5}`; // fog always has an uncertain end (lognormal)
    case "AIRPORT_CAPACITY":
      return `capacity:${input.target}:${input.start}:${dur || 240}:${input.capacity ?? 0.5}`;
    case "ATC_FLOW":
      return `atc:${input.target}:${input.start}:${dur || 180}:${input.rate ?? 20}`;
    case "CLOSURE":
      return `closure:${input.target}:${input.start}:${dur || 120}`;
    case "AOG":
      return `aog:${input.target}:${input.start}${dur ? `:${dur}` : ""}`;
    case "CREW_UNAVAILABLE":
      return `crew:${input.target}:${input.crews ?? 3}:${input.start}`;
    case "FLIGHT_DELAY":
      return `delay:${input.target}:${input.delay ?? 60}`;
  }
}
