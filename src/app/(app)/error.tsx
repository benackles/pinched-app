"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * A screen failed to load (the server threw). The shell stays put; nothing the person saved is
 * affected, and trying again is one tap. Offline is handled before this — by the service worker.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState title="That didn't load.">
      <p>Something went wrong on our side. Your plan, lists and recipes are safe.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RefreshCw aria-hidden /> Try again
        </Button>
        <Link href="/plan" className={buttonVariants({ variant: "outline" })}>
          Back to your week
        </Link>
      </div>
      {error.digest && (
        <p className="mt-4 text-xs text-muted-foreground">Reference: {error.digest}</p>
      )}
    </EmptyState>
  );
}
