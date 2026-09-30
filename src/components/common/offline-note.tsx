"use client";

import { CloudOff } from "lucide-react";

import { useOnline } from "@/hooks/use-online";

/** "Needs a connection" hint shown next to controls that are disabled while offline. */
export function OfflineNote({ what = "make changes" }: { what?: string }) {
  const online = useOnline();
  if (online) return null;
  return (
    <p
      role="status"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground"
    >
      <CloudOff className="size-4" aria-hidden /> Offline — reconnect to {what}.
    </p>
  );
}
