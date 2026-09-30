import "server-only";

import { FREE_LIMITS } from "@/lib/domain/constants";
import { monthKey } from "@/lib/domain/week";
import { must, mustMaybe } from "@/server/db";
import type { Supabase } from "@/server/supabase";

export type Usage = {
  savedRecipes: { used: number; limit: number };
  imports: { used: number; limit: number };
  prepPlans: { used: number; limit: number };
};

/** How much of the free plan has been used (shown in Settings → Billing). */
export async function loadUsage(db: Supabase, timeZone: string): Promise<Usage> {
  const [saved, prep, imports] = await Promise.all([
    db.from("saved_recipes").select("id", { count: "exact", head: true }),
    db.from("prep_plans").select("id", { count: "exact", head: true }),
    db
      .from("usage_counters")
      .select("count")
      .eq("key", `url_import:${monthKey(timeZone)}`)
      .maybeSingle(),
  ]);
  return {
    savedRecipes: { used: saved.count ?? 0, limit: FREE_LIMITS.savedRecipes },
    prepPlans: { used: prep.count ?? 0, limit: FREE_LIMITS.prepPlans },
    imports: { used: mustMaybe(imports)?.count ?? 0, limit: FREE_LIMITS.urlImportsPerMonth },
  };
}

export async function pushSubscriptionCount(db: Supabase): Promise<number> {
  return must(await db.from("push_subscriptions").select("id")).length;
}
