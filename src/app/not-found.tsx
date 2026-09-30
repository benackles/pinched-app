import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

/** Anything that doesn't match a route at all. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <Link href="/" aria-label="Pinched — home">
        <Logo className="text-3xl" />
      </Link>
      <div className="space-y-2">
        <h1 className="text-4xl font-semibold">We couldn&apos;t find that page</h1>
        <p className="text-muted-foreground">
          The link may be old, or the recipe or list may have been removed.
        </p>
      </div>
      <Link href="/plan" className={buttonVariants({ size: "lg" })}>
        Go to your week
      </Link>
    </main>
  );
}
