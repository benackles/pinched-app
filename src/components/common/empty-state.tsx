import { cn } from "@/lib/utils";

/** Friendly panel for "nothing here yet" — always says what to do next. */
export function EmptyState({
  title,
  children,
  className,
}: {
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl bg-card p-8 text-center shadow-card md:p-10", className)}>
      {title && <p className="font-display text-2xl">{title}</p>}
      {children && <div className={cn("text-muted-foreground", title && "mt-1")}>{children}</div>}
    </div>
  );
}
