"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A recipe photo that never leaves a hole: without a source (or when it fails to load) it shows
 * a calm tile with the recipe's initial. Third-party images are requested without a referrer.
 */
export function RecipeImage({
  src,
  alt,
  className,
  title,
  priority = false,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  title?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        aria-hidden
        className={cn(
          "flex items-center justify-center bg-secondary font-display text-3xl font-semibold text-muted-foreground",
          className,
        )}
      >
        {(title ?? alt).trim().charAt(0).toUpperCase() || "P"}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
