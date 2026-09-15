"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { PARAM_CLOCK, PARAM_DAY } from "@/lib/url";
import { DaySwitcher } from "./DaySwitcher";
import { ClockControl } from "./ClockControl";
import { EngineStatus, ModeTag } from "./EngineStatus";
import { Sheet } from "@/components/ui/overlay";
import { useIsPhone } from "@/hooks/useIsTouch";

export const NAV = [
  { href: "/", label: "Operations" },
  { href: "/flights", label: "Flights & resources" },
  { href: "/runs", label: "Runs" },
  { href: "/parameters", label: "Parameters" },
  { href: "/cases", label: "Cases & benchmarks" },
  { href: "/data", label: "Data" },
  { href: "/how-it-works", label: "How it works" },
] as const;

// on tablets only the three working pages stay as tabs; the rest sit behind "More"
const TABLET_TABS = new Set(["/", "/flights", "/runs"]);

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-[14px] font-bold tracking-[-0.01em] text-ivory">
      <span aria-hidden className="relative inline-block size-[18px] rounded-[5px] bg-ivory">
        <span className="absolute left-[4px] top-[8px] h-[2px] w-[10px] -rotate-[35deg] rounded-full bg-graphite" />
      </span>
      AeroNexus
    </span>
  );
}

/** Keeps ?day and ?t when moving between pages so the link is always complete. */
export function useNavHref() {
  const params = useSearchParams();
  const day = params.get(PARAM_DAY);
  const t = params.get(PARAM_CLOCK);
  const q = new URLSearchParams();
  if (day) q.set(PARAM_DAY, day);
  if (t) q.set(PARAM_CLOCK, t);
  const s = q.toString();
  return (href: string) => (s ? `${href}?${s}` : href);
}

export function TopBar() {
  const pathname = usePathname();
  const withState = useNavHref();
  const [more, setMore] = useState(false);
  const phone = useIsPhone();
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-hairline bg-panel px-4 md:px-5">
      <Link href={withState("/")} className="no-underline">
        <Wordmark />
      </Link>

      {/* page tabs: full on desktop, three + More on tablets, hidden on phones (the tab bar takes over) */}
      <nav aria-label="Pages" className="ml-2 hidden items-center gap-0.5 md:flex">
        {NAV.map((n) => {
          const active = pathname === n.href;
          return (
            <Link
              key={n.href}
              href={withState(n.href)}
              className={cn("whitespace-nowrap rounded-control px-2.5 py-1.5 text-[12.5px] no-underline transition-colors", active ? "bg-panel-2 text-ivory" : "text-ivory-2 hover:text-ivory", !TABLET_TABS.has(n.href) && "max-lg:hidden")}
            >
              {n.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMore(true)} className="rounded-control px-2.5 py-1.5 text-[12.5px] text-ivory-2 hover:text-ivory lg:hidden">
          More
        </button>
      </nav>

      {/* the decision cluster: what day, what decision point, is the engine usable */}
      <div className="ml-auto flex items-center gap-1 md:gap-2">
        <ModeTag compact={phone} />
        <DaySwitcher compact={phone} />
        <ClockControl compact={phone} />
        <EngineStatus compact={phone} />
        {phone && (
          <button type="button" onClick={() => setMore(true)} className="rounded-control p-1.5 text-ivory-2 hover:bg-panel-2 hover:text-ivory" aria-label="All pages">
            <Menu className="size-4" />
          </button>
        )}
      </div>

      <Sheet open={more} onOpenChange={setMore} title="Pages" width={360}>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <Link key={n.href} href={withState(n.href)} onClick={() => setMore(false)} className={cn("rounded-control px-3 py-2.5 text-[14px] no-underline", pathname === n.href ? "bg-panel-2 text-ivory" : "text-ivory-2 hover:bg-ivory-soft hover:text-ivory")}>
              {n.label}
            </Link>
          ))}
        </nav>
      </Sheet>
    </header>
  );
}
