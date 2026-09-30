import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Filled buttons darken on hover (mixing toward black) rather than fade: a lighter fill under white
 * text drops below AA contrast, and a pointer resting on a button is a real state to design for.
 * Buttons and nav are fully rounded. Sizes stay compact for mouse users and grow to the
 * 44px minimum tap target on touch devices (`pointer-coarse`).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-colors select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary-strong text-primary-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--color-primary-strong),black_12%)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--color-destructive),black_12%)]",
        outline: "border border-input bg-card text-foreground hover:bg-secondary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "text-foreground hover:bg-secondary",
        link: "text-primary-strong underline-offset-4 hover:underline",
        success:
          "bg-success-strong text-success-foreground shadow-sm hover:bg-[color-mix(in_oklab,var(--color-success-strong),black_12%)]",
        soft: "bg-accent text-accent-foreground hover:bg-accent/70",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 px-3.5 text-[13px] pointer-coarse:h-11",
        lg: "h-12 px-8 text-base",
        icon: "size-11",
        "icon-sm": "size-9 pointer-coarse:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      // Default to type="button" so buttons inside forms never submit by accident.
      {...(asChild ? {} : { type: type ?? "button" })}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
