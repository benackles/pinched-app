"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/** Round, cookbook-style checkbox. Completed = success green; visual 24px with a 44px hit area. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "hit-44 grid size-6 shrink-0 cursor-pointer place-content-center rounded-full border-2 border-muted-foreground/60 bg-card text-success-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-success-strong data-[state=checked]:bg-success-strong",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-content-center text-current">
        <Check className="size-4" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
