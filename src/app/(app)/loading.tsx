import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown the instant a screen is opened, while its data loads — so a tap always answers, even on a
 * slow connection. A quiet outline of the usual layout: header, a row of tiles, then content.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="mb-8 space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-64 max-w-full" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-3xl" />
        <Skeleton className="h-32 rounded-3xl" />
        <Skeleton className="h-32 rounded-3xl" />
      </div>
    </div>
  );
}
