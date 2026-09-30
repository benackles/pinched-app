import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/app-shell";
import { EmptyState } from "@/components/common/empty-state";
import { TabLinks } from "@/components/common/tab-links";
import { KitchenList, QuickAdd, type KitchenRow } from "@/components/kitchen/kitchen-client";
import { KITCHEN_LOCATIONS, type KitchenLocation } from "@/lib/domain/constants";
import { addDays, todayInZone } from "@/lib/domain/week";
import { listKitchen } from "@/server/queries/kitchen";
import { getTimezone } from "@/server/profile";
import { userClient } from "@/server/supabase";

export const metadata: Metadata = { title: "Kitchen" };

const TABS = ["all", ...KITCHEN_LOCATIONS.filter((l) => l !== "other")] as const;

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as (typeof TABS)[number])
    : "all";

  const db = await userClient();
  const items = await listKitchen(db);
  const today = todayInZone(await getTimezone());
  const soon = addDays(today, 3);

  const rows: KitchenRow[] = items
    .filter((item) => tab === "all" || item.location === tab)
    .map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      location: item.location,
      expires_at: item.expires_at,
      note: item.note,
      useSoon: item.expires_at !== null && item.expires_at <= soon,
    }));

  // On a specific tab, new items go there; on "All" each item gets a sensible default.
  const newItemLocation: KitchenLocation | null = tab === "all" ? null : (tab as KitchenLocation);

  return (
    <>
      <PageHeader eyebrow="What you already have" title="Kitchen" />
      <TabLinks
        label="Kitchen locations"
        className="mb-4"
        items={TABS.map((t) => ({
          href: t === "all" ? "/kitchen" : { pathname: "/kitchen", query: { tab: t } },
          label: t[0]!.toUpperCase() + t.slice(1),
          active: t === tab,
        }))}
      />
      <QuickAdd location={newItemLocation} />
      {rows.length === 0 ? (
        <EmptyState>
          Nothing here yet. Try “6 eggs” or “1 lb chicken thighs”. You don&apos;t need to list
          everything — the grocery list works with an empty kitchen.
        </EmptyState>
      ) : (
        <KitchenList rows={rows} />
      )}
    </>
  );
}
