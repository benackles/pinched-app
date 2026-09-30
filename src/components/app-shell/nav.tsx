"use client";

import { BookOpen, CalendarDays, ChefHat, Refrigerator, ShoppingBasket } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/plan", label: "Plan", short: "Plan", icon: CalendarDays },
  { href: "/recipes", label: "Recipes", short: "Recipes", icon: BookOpen },
  { href: "/kitchen", label: "Kitchen", short: "Kitchen", icon: Refrigerator },
  { href: "/grocery-list", label: "Grocery List", short: "Grocery", icon: ShoppingBasket },
  { href: "/prep", label: "Prep", short: "Prep", icon: ChefHat },
] as const;

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/** Top navigation pills (desktop). */
export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Bottom tab bar (phones). Five tabs, each a 44px+ tap target. */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
              active ? "text-primary-strong" : "text-muted-foreground",
            )}
          >
            <item.icon className="size-5" aria-hidden />
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}
