import Link from "next/link";

import { PageHeader } from "@/components/app-shell/app-shell";
import { EmptyState } from "@/components/common/empty-state";
import { buttonVariants } from "@/components/ui/button";

/** A recipe, collection or meal that doesn't exist (or isn't yours) — inside the app shell. */
export default function AppNotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <EmptyState title="We couldn't find that.">
        <p>It may have been removed, or the link may be out of date.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/plan" className={buttonVariants()}>
            Back to your week
          </Link>
          <Link href="/recipes" className={buttonVariants({ variant: "outline" })}>
            Your recipes
          </Link>
        </div>
      </EmptyState>
    </>
  );
}
