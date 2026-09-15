"use client";
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/* Form and choice controls. Inputs sit in wells (cut in); the chosen option in a segmented control is ivory. */

export function Select<T extends string>({ value, onChange, options, className, placeholder, ariaLabel, size = "md" }: { value: T | ""; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string; placeholder?: string; ariaLabel?: string; size?: "sm" | "md" }) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={(v) => onChange(v as T)}>
      <SelectPrimitive.Trigger aria-label={ariaLabel} className={cn("inline-flex items-center justify-between gap-2 rounded-control border border-hairline-strong bg-well px-2.5 text-[13px] text-ivory hover:border-ivory-3", size === "sm" ? "h-7 text-[12px]" : "h-8", className)}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-3.5 text-ivory-3" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="z-50 max-h-[320px] min-w-[var(--radix-select-trigger-width)] overflow-auto rounded-control border border-hairline-strong bg-panel-2 p-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item key={o.value} value={o.value} className="relative flex cursor-default select-none items-center rounded-[4px] py-1.5 pl-6 pr-2 text-[13px] outline-none data-[highlighted]:bg-ivory-soft data-[state=checked]:text-ivory">
                <SelectPrimitive.ItemIndicator className="absolute left-1.5">
                  <Check className="size-3.5" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function Slider({ value, onChange, min, max, step, ariaLabel, className }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; ariaLabel: string; className?: string }) {
  return (
    <SliderPrimitive.Root value={[value]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={step} className={cn("relative flex h-6 w-full touch-none select-none items-center", className)}>
      <SliderPrimitive.Track className="relative h-[3px] grow rounded-full bg-hairline-strong">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-amber" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb aria-label={ariaLabel} className="block size-4 rounded-full border-2 border-graphite bg-amber outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-amber" />
    </SliderPrimitive.Root>
  );
}

export function Switch({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; className?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-2 text-[13px]", className)}>
      <SwitchPrimitive.Root checked={checked} onCheckedChange={onChange} className="relative h-5 w-9 rounded-full bg-hairline-strong outline-none transition-colors data-[state=checked]:bg-ivory">
        <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-graphite shadow transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:bg-ivory" />
      </SwitchPrimitive.Root>
      {label}
    </label>
  );
}

/** A segmented control (radiogroup): the chosen segment is ivory on graphite. Used for board views and windows. */
export function Segmented<T extends string>({ value, onChange, options, ariaLabel, className, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; ariaLabel: string; className?: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex rounded-control border border-hairline-strong bg-well p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn("rounded-[4px] font-medium transition-colors", size === "sm" ? "px-2 py-0.5 text-[11.5px]" : "px-2.5 py-1 text-[12.5px]", on ? "bg-ivory text-graphite" : "text-ivory-2 hover:text-ivory")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;
export function TabList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <TabsPrimitive.List className={cn("flex gap-1 border-b border-hairline", className)}>{children}</TabsPrimitive.List>;
}
export function Tab({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Trigger value={value} className="-mb-px border-b-2 border-transparent px-2.5 py-2 text-[13px] text-ivory-2 hover:text-ivory data-[state=active]:border-ivory data-[state=active]:text-ivory">
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function Field({ label, children, hint, className }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block text-[12.5px]", className)}>
      <span className="mb-1 block text-ivory-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ivory-3">{hint}</span>}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("h-8 w-full rounded-control border border-hairline-strong bg-well px-2.5 text-[13px] text-ivory placeholder:text-ivory-3 hover:border-ivory-3 focus:border-ivory", className)} {...props} />
));
Input.displayName = "Input";
