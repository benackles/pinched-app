import Link from "next/link";

import { cn } from "@/lib/utils";

type Href = React.ComponentProps<typeof Link>["href"];

/** Tabs that are real links (the tab lives in the URL, so every tab works offline once visited). */
export function TabLinks({
  items,
  label,
  className,
}: {
  items: { href: Href; label: string; active: boolean }[];
  label: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-secondary p-1",
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center justify-center rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors pointer-coarse:h-11",
            item.active
              ? "bg-card text-foreground shadow-card"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
