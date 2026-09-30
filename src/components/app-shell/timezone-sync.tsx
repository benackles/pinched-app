"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { saveTimezone } from "@/server/actions/profile";

const COOKIE = "pinched_tz";

/**
 * Keeps the server on the person's own clock: "today", the week and reminder times depend on it.
 * Writes a cookie the server reads on the next request, and saves the zone to the profile once.
 */
export function TimezoneSync({ profileZone }: { profileZone: string | null }) {
  const router = useRouter();
  useEffect(() => {
    let zone: string;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone) return;
    const current = document.cookie
      .split("; ")
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    const changed = current !== encodeURIComponent(zone);
    if (changed) {
      document.cookie = `${COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
    }
    if (profileZone !== zone) void saveTimezone(zone);
    // The first render used a guess (UTC); redraw once with the real zone.
    if (changed && current === undefined) router.refresh();
  }, [profileZone, router]);
  return null;
}
