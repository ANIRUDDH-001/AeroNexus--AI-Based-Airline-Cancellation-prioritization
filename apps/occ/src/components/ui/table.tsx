import * as React from "react";
import { cn } from "@/lib/utils";

/** Data tables: sticky ivory-2 headers over a well, tabular figures, numbers right-aligned. Wide tables scroll
 *  inside their own container; the page never scrolls horizontally. */
export function Table({ children, className, containerClassName }: { children: React.ReactNode; className?: string; containerClassName?: string }) {
  return (
    <div className={cn("scroll-thin w-full overflow-x-auto", containerClassName)}>
      <table className={cn("w-full border-collapse text-[13px]", className)}>{children}</table>
    </div>
  );
}

export function Th({ children, className, num = false }: { children?: React.ReactNode; className?: string; num?: boolean }) {
  return <th className={cn("sticky top-0 z-[1] whitespace-nowrap border-b border-hairline-strong bg-panel px-2.5 py-1.5 text-left text-[12px] font-medium text-ivory-2", num && "num text-right", className)}>{children}</th>;
}

export function Td({ children, className, num = false, mono = false }: { children?: React.ReactNode; className?: string; num?: boolean; mono?: boolean }) {
  return <td className={cn("border-b border-hairline px-2.5 py-1.5 align-top", num && "num text-right", mono && "mono whitespace-nowrap", className)}>{children}</td>;
}

export function Tr({ children, className, onClick, selected }: { children: React.ReactNode; className?: string; onClick?: () => void; selected?: boolean }) {
  return (
    <tr onClick={onClick} className={cn(onClick && "cursor-pointer hover:bg-ivory-soft", selected && "bg-ivory-soft", className)}>
      {children}
    </tr>
  );
}
