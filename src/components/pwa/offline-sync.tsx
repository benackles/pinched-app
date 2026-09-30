"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import { useOnline } from "@/hooks/use-online";
import { pluralize } from "@/lib/format";
import { flushQueue, queueSize } from "@/lib/offline/queue";
import { replayEntry } from "@/lib/offline/replay";
import { setSyncing, useQueueEntries, useSyncing } from "@/lib/offline/use-queue";

/**
 * Header status: "Offline" with no signal, "Syncing…" while queued check-offs are sent. It is also
 * the one place that replays the queue — on load and whenever the connection returns.
 */
export function OfflineSync({ userId }: { userId: string }) {
  const online = useOnline();
  const router = useRouter();
  const pending = useQueueEntries(userId).length;
  const syncing = useSyncing();

  const sync = useCallback(async () => {
    if (!navigator.onLine || (await queueSize(userId)) === 0) return;
    setSyncing(true);
    try {
      const result = await flushQueue(userId, replayEntry);
      if (result.skipped) return;
      if (result.done) toast.success(`Synced ${pluralize(result.done, "offline change")}`);
      if (result.dropped) {
        toast(
          `${pluralize(result.dropped, "change")} couldn't be applied — the item was removed from your plan.`,
        );
      }
      if (result.done || result.dropped) router.refresh();
    } finally {
      setSyncing(false);
    }
  }, [userId, router]);

  // On load, and every time the connection comes back.
  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  if (online && pending === 0 && !syncing) return null;
  return (
    <div
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground"
    >
      {online ? (
        <RefreshCw className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <CloudOff className="size-3.5" aria-hidden />
      )}
      {online ? "Syncing…" : "Offline"}
      {pending > 0 && <span className="text-muted-foreground">· {pending} to sync</span>}
    </div>
  );
}
