import { cn } from "@/lib/utils";

/** `Pinched.` in Fraunces semibold; the period is the tomato accent. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display text-2xl font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      Pinched<span className="text-primary">.</span>
    </span>
  );
}
