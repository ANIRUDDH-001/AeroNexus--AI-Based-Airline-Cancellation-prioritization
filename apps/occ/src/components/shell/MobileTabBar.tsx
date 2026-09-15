"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CalendarDays, Layers, ListChecks, Map as MapIcon, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { PARAM_VIEW, parseView, withParams, type PhoneView } from "@/lib/url";
import { NAV, useNavHref } from "./TopBar";
import { Sheet } from "@/components/ui/overlay";
import { InstallApp } from "./InstallApp";

const VIEWS: { view: PhoneView; label: string; icon: typeof Layers }[] = [
  { view: "today", label: "Today", icon: CalendarDays },
  { view: "board", label: "Board", icon: Layers },
  { view: "map", label: "Map", icon: MapIcon },
  { view: "plans", label: "Plans", icon: ListChecks },
];

/** Phone chrome (spec §9): Today / Board / Map / Plans are views of the Operations page; More lists the pages. */
export function MobileTabBar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const withState = useNavHref();
  const [more, setMore] = useState(false);
  const onOps = pathname === "/";
  const view = parseView(params.get(PARAM_VIEW));
  return (
    <nav aria-label="Views" className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-hairline bg-panel md:hidden">
      {VIEWS.map((v) => {
        const active = onOps && view === v.view;
        const href = `/${withParams(params, { [PARAM_VIEW]: v.view === "today" ? null : v.view })}`;
        return (
          <Link key={v.view} href={href} className={cn("flex h-14 flex-col items-center justify-center gap-1 text-[11px] no-underline", active ? "text-ivory" : "text-ivory-3")} aria-current={active ? "page" : undefined}>
            <v.icon className={cn("size-5", active ? "text-amber" : "")} />
            {v.label}
          </Link>
        );
      })}
      <button type="button" onClick={() => setMore(true)} className={cn("flex h-14 flex-col items-center justify-center gap-1 text-[11px]", !onOps ? "text-ivory" : "text-ivory-3")}>
        <MoreHorizontal className="size-5" />
        More
      </button>
      <Sheet open={more} onOpenChange={setMore} title="Pages" width={360}>
        <div className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <Link key={n.href} href={withState(n.href)} onClick={() => setMore(false)} className={cn("rounded-control px-3 py-3 text-[15px] no-underline", pathname === n.href ? "bg-panel-2 text-ivory" : "text-ivory-2 hover:bg-ivory-soft hover:text-ivory")}>
              {n.label}
            </Link>
          ))}
        </div>
        <InstallApp />
      </Sheet>
    </nav>
  );
}
