"use client";

import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

/** Read-only stars, or a radio group when `onChange` is given. Never relies on colour alone: the label says the number. */
export function StarRating({
  value,
  onChange,
  size = "sm",
  disabled,
}: {
  value: number | null | undefined;
  onChange?: (rating: number) => void;
  size?: "sm" | "lg";
  disabled?: boolean;
}) {
  const cls = size === "lg" ? "size-7" : "size-4";
  const label = value ? `Rated ${value} out of 5` : "Not rated";
  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-0.5" role="img" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            aria-hidden
            className={cn(cls, (value ?? 0) >= n ? "fill-star text-star" : "text-border")}
          />
        ))}
      </span>
    );
  }
  return (
    <div className="inline-flex items-center gap-0.5" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          disabled={disabled}
          // Clicking the current rating again clears it.
          onClick={() => onChange(value === n ? 0 : n)}
          className="hit-44 rounded p-0.5 transition-transform hover:scale-110 disabled:opacity-50"
        >
          <Star
            aria-hidden
            className={cn(
              cls,
              (value ?? 0) >= n ? "fill-star text-star" : "text-muted-foreground/50",
            )}
          />
        </button>
      ))}
    </div>
  );
}
