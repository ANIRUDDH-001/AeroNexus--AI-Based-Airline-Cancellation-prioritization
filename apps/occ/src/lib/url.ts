/** The console keeps its working state in the URL so any screen is linkable: ?day=<instance>&t=<minutes>
 *  on every route, &run=<id> on Operations and Runs, &view= on phones, &sheet= while a sheet is open. */

export const PARAM_DAY = "day";
export const PARAM_CLOCK = "t";
export const PARAM_RUN = "run";
export const PARAM_VIEW = "view";
export const PARAM_SHEET = "sheet";

export const DEFAULT_CLOCK = 300; // 05:00, the demo's first decision time

export type PhoneView = "today" | "board" | "map" | "plans";
export const PHONE_VIEWS: PhoneView[] = ["today", "board", "map", "plans"];

/** A decision time is a whole number of minutes in [0, 1440), on the 15-minute grid the clock control uses. */
export function parseClock(raw: string | null | undefined, fallback = DEFAULT_CLOCK): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(1425, Math.max(0, Math.round(n / 15) * 15));
  return clamped;
}

export function parseView(raw: string | null | undefined): PhoneView {
  return (PHONE_VIEWS as string[]).includes(raw ?? "") ? (raw as PhoneView) : "today";
}

/** Returns the query string for `params` merged into `current`; null values remove the key. Keys are written in
 *  a fixed order so two equal states give the same URL. */
export function withParams(current: URLSearchParams | string, params: Record<string, string | number | null | undefined>): string {
  const next = new URLSearchParams(typeof current === "string" ? current : current.toString());
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") next.delete(k);
    else next.set(k, String(v));
  }
  const order = [PARAM_DAY, PARAM_CLOCK, PARAM_RUN, PARAM_VIEW, PARAM_SHEET];
  const ordered = new URLSearchParams();
  for (const k of order) {
    const v = next.get(k);
    if (v != null) ordered.set(k, v);
  }
  for (const [k, v] of next) if (!order.includes(k)) ordered.append(k, v);
  const s = ordered.toString();
  return s ? `?${s}` : "";
}
