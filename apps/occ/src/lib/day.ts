import type { InstanceRow } from "./api";

/** The demo day the console opens when nothing is remembered: the medium synthetic day with fog at Delhi and an
 *  aircraft on ground, because that is the story the precomputed bundle and the walkthrough are built around. */
export function pickDefaultDay(rows: InstanceRow[]): InstanceRow | null {
  if (!rows.length) return null;
  const demo = rows.find((r) => r.name === "synthetic-medium-seed1" && Number(r.summary?.disruptions ?? 0) >= 2);
  return demo ?? rows[0];
}

const SIZE_WORD: Record<string, string> = { small: "Small", medium: "Medium", large: "Large", custom: "Imported" };

/** "Medium synthetic day" — what the day switcher shows instead of the generator's file name. */
export function dayTitle(row: Pick<InstanceRow, "name" | "size" | "seed">): string {
  const size = SIZE_WORD[row.size] ?? "Custom";
  if (row.seed == null && row.size === "custom") return row.name;
  return `${size} synthetic day`;
}

/** "Seed 1, 259 flights, 12 airports" — the day's provenance line. */
export function dayDetail(row: InstanceRow): string {
  const s = row.summary ?? {};
  const bits: string[] = [];
  if (row.seed != null) bits.push(`Seed ${row.seed}`);
  if (s.flights != null) bits.push(`${s.flights} flights`);
  if (s.airports != null) bits.push(`${s.airports} airports`);
  const d = Number(s.disruptions ?? 0);
  if (d) bits.push(`${d} disruption${d === 1 ? "" : "s"}`);
  return bits.join(", ");
}

export const isSynthetic = (row: Pick<InstanceRow, "name" | "seed">): boolean => row.seed != null || row.name.startsWith("synthetic-");
