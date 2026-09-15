import * as React from "react";
import { cn } from "@/lib/utils";

/** A raised surface. Depth comes from the panel on the graphite ground and, inside it, wells that cut in
 *  (the board canvas, the map). No shadows. */
export function Panel({ title, aside, children, className, bodyClassName, well = false }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; well?: boolean }) {
  return (
    <section className={cn("rounded-panel border border-hairline bg-panel", className)}>
      {(title || aside) && (
        <header className="flex min-h-[42px] items-center gap-3 border-b border-hairline px-3.5 py-2">
          {title && <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>}
          {aside && <div className="ml-auto flex items-center gap-2 text-[12px] text-ivory-2">{aside}</div>}
        </header>
      )}
      <div className={cn(well ? "rounded-b-panel bg-well" : "", bodyClassName ?? "p-3.5")}>{children}</div>
    </section>
  );
}

/** An empty screen is an invitation to act. */
export function EmptyState({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-panel border border-dashed border-hairline-strong px-6 py-10 text-center", className)}>
      <p className="mx-auto max-w-[52ch] text-[14px] text-ivory-2">{children}</p>
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Loading placeholders are quiet outlines, never shimmer. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded-strip border border-hairline-strong/60", className)} />;
}

/** One line under every page title saying what the page is for, in the same voice everywhere. */
export function PageTitle({ title, purpose, aside }: { title: string; purpose: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-2">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>
        <p className="mt-0.5 text-[13px] text-ivory-2">{purpose}</p>
      </div>
      {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
    </div>
  );
}
