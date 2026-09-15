"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** The primary action is ivory on graphite; there is no blue anywhere. Outline for secondary actions, ghost for
 *  quiet ones, danger (coral outline) for destructive ones. Heights meet 44 px on touch via the `lg` size. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-[13px] font-semibold no-underline transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ivory text-graphite hover:bg-white",
        outline: "border border-hairline-strong bg-transparent text-ivory hover:bg-panel-2",
        ghost: "text-ivory-2 hover:bg-panel-2 hover:text-ivory",
        danger: "border border-coral/50 text-coral hover:bg-coral-soft",
      },
      size: {
        sm: "h-7 px-2.5 text-[12px]",
        md: "h-8 px-3",
        lg: "h-11 px-4 text-[14px]",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type = "button", ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} type={asChild ? undefined : type} {...props} />;
});
Button.displayName = "Button";

export { buttonVariants };
