"use client";
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsTouch } from "@/hooks/useIsTouch";

/* The floating layer: tooltip (hover, desktop), popover (click/tap), hover card (rich, with a grace delay),
   sheet (side on desktop, full-screen on phones) and dialog (confirmations). One surface style for all:
   panel-2 with a strong hairline, 6 px radius. */

const surface = "z-50 rounded-control border border-hairline-strong bg-panel-2 text-ivory shadow-[0_12px_32px_rgba(0,0,0,0.45)]";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} collisionPadding={8} className={cn(surface, "max-w-[320px] px-2.5 py-1.5 text-[12px] leading-snug")}>
          {content}
          <TooltipPrimitive.Arrow className="fill-panel-2" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, children, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content sideOffset={6} collisionPadding={8} className={cn(surface, "w-[320px] p-3 text-[13px] outline-none", className)} {...props}>
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

/** Rich hover content with a grace delay: 250 ms to open so a pointer sweeping across a board does not strobe
 *  cards, 180 ms to close so the pointer can travel into it. */
export function HoverCard({ content, children, side = "top", open, onOpenChange }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right"; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return (
    <HoverCardPrimitive.Root openDelay={250} closeDelay={180} open={open} onOpenChange={onOpenChange}>
      <HoverCardPrimitive.Trigger asChild>{children}</HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content side={side} sideOffset={6} collisionPadding={8} className={cn(surface, "w-[320px] p-3 text-[13px] outline-none")}>
          {content}
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

/** A side sheet on desktop, a full-screen sheet on phones (spec §9). */
export function Sheet({ open, onOpenChange, title, description, children, width = 560, footer }: { open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; width?: number; footer?: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <DialogPrimitive.Content
          style={{ ["--sheet-w" as string]: `${width}px` }}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[var(--sheet-w)] flex-col border-l border-hairline bg-panel outline-none max-md:max-w-none"
        >
          <header className="flex items-start gap-3 border-b border-hairline px-4 py-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-0.5 text-[12.5px] text-ivory-2">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-control p-1.5 text-ivory-2 hover:bg-panel-2 hover:text-ivory" aria-label="Close">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && <footer className="pb-safe flex items-center gap-2 border-t border-hairline px-4 py-3">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A centred confirmation. */
export function Dialog({ open, onOpenChange, title, description, children, footer }: { open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-panel border border-hairline-strong bg-panel p-5 outline-none">
          <DialogPrimitive.Title className="text-[16px] font-semibold">{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description className="mt-1.5 text-[13.5px] text-ivory-2">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          {children && <div className="mt-3 text-[13.5px]">{children}</div>}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The inline-definition primitive (spec §8): a term with a dotted underline; hover on desktop, tap on touch. */
export function Define({ label, short, long, children, className }: { label?: string; short: string; long?: string; children: React.ReactNode; className?: string }) {
  const touch = useIsTouch();
  const body = (
    <div className="space-y-1">
      {label && <div className="text-[12px] font-semibold text-ivory">{label}</div>}
      <div className="text-[12.5px] leading-snug text-ivory">{short}</div>
      {long && <div className="text-[12px] leading-snug text-ivory-2">{long}</div>}
    </div>
  );
  const trigger = (
    <span tabIndex={0} className={cn("cursor-help underline decoration-dotted decoration-ivory-3 underline-offset-[3px] hover:decoration-ivory", className)}>
      {children}
    </span>
  );
  if (touch)
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className="w-[280px]">{body}</PopoverContent>
      </Popover>
    );
  return <Tooltip content={body}>{trigger}</Tooltip>;
}
