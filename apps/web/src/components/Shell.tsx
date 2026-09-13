import type { ReactNode } from "react";
import { AlertTriangle, Database, FlaskConical, History, LayoutDashboard, ListChecks, Plane, SlidersHorizontal, Table2 } from "lucide-react";
import { hhmm } from "@/lib/api";
import { useStore } from "@/lib/store";

export type PageKey = "overview" | "disruptions" | "recommendations" | "flights" | "parameters" | "cases" | "runs" | "data";

const NAV: { key: PageKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "disruptions", label: "Disruptions", icon: AlertTriangle },
  { key: "recommendations", label: "Recommendations", icon: ListChecks },
  { key: "flights", label: "Flights & resources", icon: Table2 },
  { key: "parameters", label: "Parameters", icon: SlidersHorizontal },
  { key: "cases", label: "Cases & benchmarks", icon: FlaskConical },
  { key: "runs", label: "Runs", icon: History },
  { key: "data", label: "Data", icon: Database },
];

export function Shell({ page, onNavigate, status, children }: { page: PageKey; onNavigate: (p: PageKey) => void; status?: ReactNode; children: ReactNode }) {
  const { instances, instanceId, setInstanceId, clock, setClock } = useStore();
  const needsContext = page !== "data" && page !== "parameters" && page !== "cases";
  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 bg-sidebar border-r border-border flex flex-col">
        <div className="px-4 py-3 flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white">
            <Plane size={14} />
          </span>
          <div className="leading-tight">
            <div className="font-semibold text-[14px]">AeroNexus</div>
            <div className="text-[11px] text-ink-2">OCC decision support</div>
          </div>
        </div>
        <nav className="px-2 py-1 flex-1">
          {NAV.map(({ key, label, icon: Icon }) => {
            const active = key === page;
            return (
              <button
                key={key}
                onClick={() => onNavigate(key)}
                className={["w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-left transition-colors text-ink", active ? "bg-hover font-medium" : "hover:bg-hover"].join(" ")}
              >
                <Icon size={15} className={active ? "text-ink" : "text-ink-2"} />
                <span className="flex-1">{label}</span>
              </button>
            );
          })}
        </nav>
        <div className="px-4 py-3 text-[11px] text-ink-2 border-t border-border">{status}</div>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        {needsContext && (
          <div className="sticky top-0 z-10 bg-bg/95 backdrop-blur border-b border-border px-6 py-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <label className="flex items-center gap-2 text-ink-2">
              Day
              <select className="rounded-md border border-border bg-bg px-2 py-1 text-[13px] text-ink max-w-[22rem] truncate" value={instanceId ?? ""} onChange={(e) => setInstanceId(e.target.value || null)}>
                {instances.length === 0 && <option value="">— generate one on the Data page —</option>}
                {instances.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.summary.flights} flights{r.summary.disruptions ? ` · ${r.summary.disruptions} disruption(s)` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-ink-2">
              Decision time
              <input type="range" min={0} max={1440} step={15} value={clock} onChange={(e) => setClock(Number(e.target.value))} className="w-40 accent-accent" />
              <span className="font-mono text-ink w-12">{hhmm(clock)}</span>
            </label>
          </div>
        )}
        <div className="max-w-6xl mx-auto px-6 py-8 min-w-0">{children}</div>
      </main>
    </div>
  );
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header className="mb-6 flex items-start gap-4">
      <div className="flex-1">
        <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="text-ink-2 mt-1">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Tag({ tone = "blue", children, title }: { tone?: "blue" | "ok" | "warn" | "bad" | "gray"; children: ReactNode; title?: string }) {
  const cls = { blue: "bg-tag-blue-bg text-tag-blue-ink", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", gray: "bg-hover text-ink-2" }[tone];
  return (
    <span title={title} className={`inline-block rounded px-1.5 py-0.5 text-[12px] font-medium whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

export function Button({ children, onClick, variant = "primary", disabled, title, type = "button" }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger"; disabled?: boolean; title?: string; type?: "button" | "submit" }) {
  const base = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50 whitespace-nowrap";
  const cls = variant === "primary" ? "bg-accent text-white hover:bg-accent-hover" : variant === "danger" ? "border border-bad text-bad hover:bg-bad-soft" : "border border-border bg-bg text-ink hover:bg-hover";
  return (
    <button type={type} title={title} className={`${base} ${cls}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-md border border-border p-4 ${className}`}>{children}</section>;
}

export function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "bad" | "ok" }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink";
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[12px] text-ink-2">{label}</div>
      <div className={`text-[20px] font-semibold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

export const inputCls = "rounded-md border border-border bg-bg px-2 py-1 text-[13px] text-ink focus:outline-none focus:border-accent";

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-ink-2 text-[13px] py-6">{children}</p>;
}
