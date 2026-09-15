/** Number and time formatting in the console's voice: Indian grouping, lakh/crore rupees, HH:MM past midnight. */

/** Minutes from 00:00 -> "HH:MM", with "+1" when the time spills into the next day. */
export const hhmm = (m: number | null | undefined): string => {
  if (m == null) return "—";
  const day = Math.floor(m / 1440);
  const rem = m - day * 1440;
  const h = Math.floor(rem / 60);
  const mm = rem % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}${day ? `+${day}` : ""}`;
};

/** Integer-ish counts with Indian digit grouping (12,34,567). */
export const fmt = (n: number | null | undefined, digits = 0): string => (n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: digits }));

/** Rupees the way a controller says them: ₹4.1 lakh, ₹1.2 crore, ₹850. */
export const inr = (n: number | null | undefined): string => {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(abs >= 1e8 ? 0 : 1)} crore`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(abs >= 1e6 ? 0 : 1)} lakh`;
  return `${sign}₹${fmt(abs)}`;
};

/** "40 min", "2 h 15 min", "3 h". */
export const minutes = (m: number | null | undefined): string => {
  if (m == null) return "—";
  const total = Math.round(m);
  const h = Math.floor(total / 60);
  const mm = total % 60;
  if (!h) return `${mm} min`;
  return mm ? `${h} h ${mm} min` : `${h} h`;
};

export const pct = (x: number | null | undefined, digits = 0): string => (x == null ? "—" : `${(x * 100).toFixed(digits)}%`);

/** "1 flight" / "3 flights". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${fmt(n)} ${n === 1 ? one : many}`;

/** "2.1 s" / "850 ms" for engine latency. */
export const seconds = (ms: number | null | undefined): string => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
