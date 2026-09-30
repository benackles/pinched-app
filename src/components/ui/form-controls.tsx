import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const field =
  "w-full rounded-xl border border-input bg-card px-4 text-base text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        field,
        "h-11 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

/** Pill-shaped variant used for search and quick-add boxes. */
function PillInput({ className, ...props }: React.ComponentProps<"input">) {
  return <Input className={cn("h-12 rounded-full px-5", className)} {...props} />;
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea data-slot="textarea" className={cn(field, "min-h-24 py-3", className)} {...props} />
  );
}

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("text-sm font-semibold leading-none select-none", className)}
      {...props}
    />
  );
}

/**
 * Native <select>, styled. On phones this opens the OS picker, which is faster and more
 * accessible than a custom listbox, and it works in every offline/cached state.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(field, "h-11 cursor-pointer appearance-none pr-10", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

function FieldError({ children, id }: { children?: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-sm font-medium text-destructive">
      {children}
    </p>
  );
}

export { Input, PillInput, Textarea, Label, NativeSelect, FieldError };
