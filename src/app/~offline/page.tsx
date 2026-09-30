import type { Metadata } from "next";
import { CloudOff } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { ReloadButton } from "@/components/pwa/reload-button";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/**
 * Precached by the service worker and shown when a page was never opened on this device and
 * there is no signal. Everything you have opened before still loads from the links below.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo className="text-3xl" />
      <div className="grid size-16 place-items-center rounded-full bg-secondary text-muted-foreground">
        <CloudOff className="size-8" aria-hidden />
      </div>
      <div className="space-y-2">
        <h1 className="text-4xl font-semibold">You&apos;re offline</h1>
        <p className="text-muted-foreground">
          This screen hasn&apos;t been opened on this phone yet. The week, grocery list and prep
          plan you last loaded are still available.
        </p>
      </div>
      <nav aria-label="Available offline" className="flex flex-wrap justify-center gap-2">
        {[
          ["/plan", "This week"],
          ["/grocery-list", "Grocery list"],
          ["/prep", "Prep"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="inline-flex h-11 items-center rounded-full bg-secondary px-5 text-sm font-semibold text-secondary-foreground hover:bg-secondary/70"
          >
            {label}
          </a>
        ))}
      </nav>
      <ReloadButton />
    </main>
  );
}
