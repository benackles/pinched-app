import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn("animate-pulse rounded-2xl bg-secondary/80", className)}
      {...props}
    />
  );
}

export { Skeleton };
