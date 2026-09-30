/**
 * The `Database` type supabase-js needs, derived from the Drizzle schema — one source of truth,
 * no codegen step. Property names are snake_case, so row types are exactly what PostgREST returns
 * (timestamps as ISO strings, numerics as numbers).
 */
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

import type * as schema from "./schema";

type Tables = {
  profiles: typeof schema.profiles;
  subscriptions: typeof schema.subscriptions;
  usage_counters: typeof schema.usage_counters;
  recipes: typeof schema.recipes;
  ingredients: typeof schema.ingredients;
  recipe_steps: typeof schema.recipe_steps;
  saved_recipes: typeof schema.saved_recipes;
  recipe_modifications: typeof schema.recipe_modifications;
  recipe_notes: typeof schema.recipe_notes;
  recipe_media: typeof schema.recipe_media;
  collections: typeof schema.collections;
  collection_items: typeof schema.collection_items;
  kitchen_items: typeof schema.kitchen_items;
  weekly_plans: typeof schema.weekly_plans;
  planned_meals: typeof schema.planned_meals;
  grocery_lists: typeof schema.grocery_lists;
  grocery_list_items: typeof schema.grocery_list_items;
  grocery_item_sources: typeof schema.grocery_item_sources;
  prep_plans: typeof schema.prep_plans;
  prep_tasks: typeof schema.prep_tasks;
  prep_task_meals: typeof schema.prep_task_meals;
  prep_edit_log: typeof schema.prep_edit_log;
  cooking_events: typeof schema.cooking_events;
  push_subscriptions: typeof schema.push_subscriptions;
  push_deliveries: typeof schema.push_deliveries;
};

export type TableName = keyof Tables;

export type Database = {
  public: {
    Tables: {
      [K in TableName]: {
        Row: InferSelectModel<Tables[K]>;
        Insert: InferInsertModel<Tables[K]>;
        Update: Partial<InferInsertModel<Tables[K]>>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      /** Bumps a per-user counter; raises `limit_exceeded:<key>` past `p_limit`. */
      increment_usage: { Args: { p_key: string; p_limit?: number | null }; Returns: number };
      /** Whether the signed-in user has an active, trialing or past-due subscription. */
      is_pro: { Args: { [_ in never]: never }; Returns: boolean };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Row<T extends TableName> = Database["public"]["Tables"][T]["Row"];
export type Insert<T extends TableName> = Database["public"]["Tables"][T]["Insert"];
export type Update<T extends TableName> = Database["public"]["Tables"][T]["Update"];
