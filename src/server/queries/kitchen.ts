import "server-only";

import type { Row } from "@/db/types";
import type { KitchenStock } from "@/lib/domain/grocery";
import { must } from "@/server/db";
import type { Supabase } from "@/server/supabase";

export async function listKitchen(db: Supabase): Promise<Row<"kitchen_items">[]> {
  return must(await db.from("kitchen_items").select("*").order("name"));
}

export const toStock = (items: Row<"kitchen_items">[]): KitchenStock[] =>
  items.map((item) => ({
    name: item.name,
    normalized_name: item.normalized_name,
    quantity: item.quantity,
    unit: item.unit,
  }));
