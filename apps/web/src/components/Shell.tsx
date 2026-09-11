import type { ReactNode } from "react";
import {
  AlertTriangle,
  Database,
  FlaskConical,
  History,
  LayoutDashboard,
  ListChecks,
  Plane,
  SlidersHorizontal,
  Table2,
} from "lucide-react";

export type PageKey =
  | "overview"
  | "disruptions"
  | "recommendations"
  | "flights"
  | "parameters"
  | "cases"
  | "runs"
  | "data";

const NAV: { key: PageKey; label: string; icon: typeof LayoutDashboard; ready: boolean }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, ready: true },
  { key: "disruptions", label: "Disruptions", icon: AlertTriangle, ready: false },
  { key: "recommendations", label: "Recommendations", icon: ListChecks, ready: false },
  { key: "flights", label: "Flights & resources", icon: Table2, ready: false },
  { key: "parameters", label: "Parameters", icon: SlidersHorizontal, ready: true },
  { key: "cases", label: "Cases & benchmarks", icon: FlaskConical, ready: false },
  { key: "runs", label: "Runs", icon: History, ready: false },
  { key: "data", label: "Data", icon: Database, ready: true },
];

export function Shell({
  page,
  onNavigate,
  status,
  children,
}: {
  page: PageKey;
  onNavigate: (p: PageKey) => void;
  status?: ReactNode;
  children: ReactNode;
}) {
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
          {NAV.map(({ key, label, icon: Icon, ready }) => {
            const active = key === page;
            return (
              <button
                key={key}
                onClick={() => onNavigate(key)}
                className={[
                  "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-left transition-colors",
                  active ? "bg-hover font-medium" : "hover:bg-hover",
                  ready ? "text-ink" : "text-ink-2",
                ].join(" ")}
              >
                <Icon size={15} className={active ? "text-ink" : "text-ink-2"} />
                <span className="flex-1">{label}</span>
                {!ready && <span className="text-[10px] uppercase tracking-wide text-ink-3">soon</span>}
              </button>
            );
          })}
        </nav>
        <div className="px-4 py-3 text-[11px] text-ink-2 border-t border-border">{status}</div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-10 py-10">{children}</div>
      </main>
    </div>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
      {subtitle && <p className="text-ink-2 mt-1">{subtitle}</p>}
    </header>
  );
}

export function Tag({ tone = "blue", children }: { tone?: "blue" | "ok" | "warn" | "bad" | "gray"; children: ReactNode }) {
  const cls = {
    blue: "bg-tag-blue-bg text-tag-blue-ink",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    gray: "bg-hover text-ink-2",
  }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[12px] font-medium ${cls}`}>{children}</span>;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
}) {
  const base = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50";
  const cls =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-hover"
      : "border border-border bg-bg text-ink hover:bg-hover";
  return (
    <button className={`${base} ${cls}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
