/**
 * Pinched database schema (Drizzle) — the source of truth for migrations and TypeScript types.
 *
 * Tenancy model
 * -------------
 * Every user-owned table carries `user_id` (the Clerk user id, text) with an RLS policy that
 * compares it to the JWT subject: `user_id = (select auth.jwt() ->> 'sub')`. Supabase is
 * configured with Clerk as a third-party auth provider, so `auth.jwt()` is the Clerk session token.
 *
 * Child tables carry `user_id` too and reference their parent with a COMPOSITE foreign key
 * `(parent_id, user_id) -> parent(id, user_id)`. A row can therefore never be attached to another
 * user's parent, policies stay a cheap column comparison (no per-row subqueries), and a
 * misconfigured policy on one table cannot leak another tenant's data through a join.
 *
 * Property names are snake_case on purpose: they match the columns PostgREST returns, so the
 * inferred row types in `types.ts` are exactly what supabase-js hands back.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  GROCERY_SECTIONS,
  KITCHEN_LOCATIONS,
  MEAL_TYPES,
  MEDIA_KINDS,
  OWNED_REASONS,
  PLAN_STATUSES,
  RECIPE_SOURCES,
} from "../lib/domain/constants";
import type { PrepEditSnapshot, RecipeChanges } from "../lib/domain/types";

// Supabase-managed roles: referenced by policies, never created by migrations.
export const authenticated = pgRole("authenticated").existing();

/** Policy expression: the signed-in Clerk user. Wrapped in (select …) so Postgres caches it per query. */
const sub = sql.raw("(select auth.jwt() ->> 'sub')");
/** Column default: stamped from the JWT so the client never supplies (or spoofs) a user id. */
const subDefault = sql.raw("(auth.jwt() ->> 'sub')");

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", "));

const id = () => uuid().primaryKey().defaultRandom();
const userId = () => text().notNull().default(subDefault);
const tstz = () => timestamp({ withTimezone: true, mode: "string" });
const createdAt = () => tstz().notNull().defaultNow();
const updatedAt = () => tstz().notNull().defaultNow();

/** select / insert / update / delete own rows — the standard policy set for user tables. */
const ownRows = (table: string) => [
  pgPolicy(`${table}: select own`, { for: "select", to: authenticated, using: sql`user_id = ${sub}` }),
  pgPolicy(`${table}: insert own`, { for: "insert", to: authenticated, withCheck: sql`user_id = ${sub}` }),
  pgPolicy(`${table}: update own`, {
    for: "update",
    to: authenticated,
    using: sql`user_id = ${sub}`,
    withCheck: sql`user_id = ${sub}`,
  }),
  pgPolicy(`${table}: delete own`, { for: "delete", to: authenticated, using: sql`user_id = ${sub}` }),
];

// ───────────────────────────────────────── accounts ─────────────────────────────────────────

/** Mirrors Clerk. Created by the Clerk webhook (or on first load as a fallback). */
export const profiles = pgTable(
  "profiles",
  {
    user_id: text().primaryKey().default(subDefault),
    email: text(),
    name: text(),
    /** Written only by the Stripe webhook / server (column privileges block client writes). */
    stripe_customer_id: text().unique(),
    /** ISO weekday for the prep session: 1 = Monday … 7 = Sunday. */
    prep_day: smallint().notNull().default(7),
    /** Local time of day for push reminders. */
    reminder_time: time().notNull().default("17:00:00"),
    /** IANA timezone, so reminders and "today" land on the person's own clock. */
    timezone: text(),
    remind_prep: boolean().notNull().default(true),
    remind_dinner: boolean().notNull().default(true),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    check("profiles_prep_day_check", sql`${t.prep_day} between 1 and 7`),
    // Users read and edit their own profile; nobody deletes it from the client.
    pgPolicy("profiles: select own", { for: "select", to: authenticated, using: sql`user_id = ${sub}` }),
    pgPolicy("profiles: insert own", { for: "insert", to: authenticated, withCheck: sql`user_id = ${sub}` }),
    pgPolicy("profiles: update own", {
      for: "update",
      to: authenticated,
      using: sql`user_id = ${sub}`,
      withCheck: sql`user_id = ${sub}`,
    }),
  ],
);

/** Written only by the Stripe webhook (service role). Users can read their own row. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    user_id: text().primaryKey(),
    stripe_subscription_id: text().notNull().unique(),
    stripe_customer_id: text().notNull(),
    status: text().notNull(),
    plan: text(),
    price_id: text(),
    current_period_end: tstz(),
    trial_end: tstz(),
    cancel_at_period_end: boolean().notNull().default(false),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  () => [
    pgPolicy("subscriptions: select own", { for: "select", to: authenticated, using: sql`user_id = ${sub}` }),
  ],
);

/** Free-tier and abuse counters. Incremented only through the increment_usage() function. */
export const usage_counters = pgTable(
  "usage_counters",
  {
    user_id: text().notNull(),
    key: text().notNull(),
    count: integer().notNull().default(0),
    updated_at: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "usage_counters_pkey", columns: [t.user_id, t.key] }),
    pgPolicy("usage_counters: select own", { for: "select", to: authenticated, using: sql`user_id = ${sub}` }),
  ],
);

// ───────────────────────────────────────── recipes ─────────────────────────────────────────

/**
 * The recipe catalog and the user's own recipes.
 *  - seeded: owned by Pinched (owner_id null); visible to everyone once published_at is set
 *    (human review before publish).
 *  - url_import / manual: private to their owner.
 */
export const recipes = pgTable(
  "recipes",
  {
    id: id(),
    source: text().notNull(),
    /** Page the recipe was imported from (credit + dedupe). Never the source page's headnote. */
    source_url: text(),
    /** Stable id for seeded recipes so the catalog can be re-seeded idempotently. */
    slug: text(),
    title: text().notNull(),
    author: text(),
    headnote: text(),
    image_url: text(),
    prep_minutes: integer(),
    cook_minutes: integer(),
    total_minutes: integer(),
    servings: integer(),
    /** Original yield wording, e.g. "Makes 12 muffins". */
    servings_label: text(),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    owner_id: text().default(subDefault),
    published_at: tstz(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    unique("recipes_id_owner_key").on(t.id, t.owner_id),
    check("recipes_source_check", sql`${t.source} in (${list(RECIPE_SOURCES)})`),
    check(
      "recipes_owner_check",
      sql`(${t.source} = 'seeded' and ${t.owner_id} is null) or (${t.source} <> 'seeded' and ${t.owner_id} is not null)`,
    ),
    check("recipes_servings_check", sql`${t.servings} is null or ${t.servings} between 1 and 999`),
    uniqueIndex("recipes_seeded_slug_key").on(t.slug).where(sql`${t.source} = 'seeded'`),
    uniqueIndex("recipes_import_url_key")
      .on(t.owner_id, t.source_url)
      .where(sql`${t.source} = 'url_import'`),
    index("recipes_owner_idx").on(t.owner_id),
    pgPolicy("recipes: select catalog or own", {
      for: "select",
      to: authenticated,
      using: sql`(source = 'seeded' and published_at is not null) or owner_id = ${sub}`,
    }),
    pgPolicy("recipes: insert own", {
      for: "insert",
      to: authenticated,
      withCheck: sql`owner_id = ${sub} and source in ('url_import', 'manual')`,
    }),
    pgPolicy("recipes: update own", {
      for: "update",
      to: authenticated,
      using: sql`owner_id = ${sub} and source <> 'seeded'`,
      withCheck: sql`owner_id = ${sub} and source <> 'seeded'`,
    }),
    pgPolicy("recipes: delete own", {
      for: "delete",
      to: authenticated,
      using: sql`owner_id = ${sub} and source <> 'seeded'`,
    }),
  ],
);

/** Drives the grocery list and the prep plan. */
export const ingredients = pgTable(
  "ingredients",
  {
    id: id(),
    recipe_id: uuid().notNull(),
    /** Same as the recipe's owner (null for seeded) — keeps the policy a column comparison. */
    owner_id: text().default(subDefault),
    sort_order: integer().notNull().default(0),
    quantity: numeric({ mode: "number" }),
    /** Upper bound of a range ("2–3 cloves"). The grocery list uses it — over-adding beats under-buying. */
    quantity_max: numeric({ mode: "number" }),
    unit: text(),
    name: text().notNull(),
    normalized_name: text().notNull(),
    preparation: text(),
    /** The line exactly as written; shown whenever a quantity is uncertain. */
    raw_text: text().notNull(),
    grocery_section: text().notNull().default("Other"),
    /** "For the sauce" style group header. */
    group_label: text(),
  },
  (t) => [
    foreignKey({ name: "ingredients_recipe_fk", columns: [t.recipe_id], foreignColumns: [recipes.id] }).onDelete("cascade"),
    foreignKey({
      name: "ingredients_recipe_owner_fk",
      columns: [t.recipe_id, t.owner_id],
      foreignColumns: [recipes.id, recipes.owner_id],
    }).onDelete("cascade"),
    check("ingredients_section_check", sql`${t.grocery_section} in (${list(GROCERY_SECTIONS)})`),
    index("ingredients_recipe_idx").on(t.recipe_id),
    pgPolicy("ingredients: select catalog or own", {
      for: "select",
      to: authenticated,
      using: sql`owner_id is null or owner_id = ${sub}`,
    }),
    pgPolicy("ingredients: insert own", { for: "insert", to: authenticated, withCheck: sql`owner_id = ${sub}` }),
    pgPolicy("ingredients: update own", {
      for: "update",
      to: authenticated,
      using: sql`owner_id = ${sub}`,
      withCheck: sql`owner_id = ${sub}`,
    }),
    pgPolicy("ingredients: delete own", { for: "delete", to: authenticated, using: sql`owner_id = ${sub}` }),
  ],
);

export const recipe_steps = pgTable(
  "recipe_steps",
  {
    id: id(),
    recipe_id: uuid().notNull(),
    owner_id: text().default(subDefault),
    step_number: integer().notNull(),
    instruction: text().notNull(),
  },
  (t) => [
    foreignKey({ name: "recipe_steps_recipe_fk", columns: [t.recipe_id], foreignColumns: [recipes.id] }).onDelete("cascade"),
    foreignKey({
      name: "recipe_steps_recipe_owner_fk",
      columns: [t.recipe_id, t.owner_id],
      foreignColumns: [recipes.id, recipes.owner_id],
    }).onDelete("cascade"),
    unique("recipe_steps_recipe_step_key").on(t.recipe_id, t.owner_id, t.step_number).nullsNotDistinct(),
    index("recipe_steps_recipe_idx").on(t.recipe_id),
    pgPolicy("recipe_steps: select catalog or own", {
      for: "select",
      to: authenticated,
      using: sql`owner_id is null or owner_id = ${sub}`,
    }),
    pgPolicy("recipe_steps: insert own", { for: "insert", to: authenticated, withCheck: sql`owner_id = ${sub}` }),
    pgPolicy("recipe_steps: update own", {
      for: "update",
      to: authenticated,
      using: sql`owner_id = ${sub}`,
      withCheck: sql`owner_id = ${sub}`,
    }),
    pgPolicy("recipe_steps: delete own", { for: "delete", to: authenticated, using: sql`owner_id = ${sub}` }),
  ],
);

/** The recipe book: what a user has saved. */
export const saved_recipes = pgTable(
  "saved_recipes",
  {
    id: id(),
    user_id: userId(),
    recipe_id: uuid().notNull(),
    favorite: boolean().notNull().default(false),
    personal_rating: smallint(),
    saved_at: createdAt(),
  },
  (t) => [
    foreignKey({ name: "saved_recipes_recipe_fk", columns: [t.recipe_id], foreignColumns: [recipes.id] }).onDelete("cascade"),
    unique("saved_recipes_user_recipe_key").on(t.user_id, t.recipe_id),
    unique("saved_recipes_id_user_key").on(t.id, t.user_id),
    check("saved_recipes_rating_check", sql`${t.personal_rating} is null or ${t.personal_rating} between 1 and 5`),
    index("saved_recipes_user_idx").on(t.user_id),
    ...ownRows("saved_recipes"),
  ],
);

/** Personal version — the original recipe stays untouched. */
export const recipe_modifications = pgTable(
  "recipe_modifications",
  {
    id: id(),
    user_id: userId(),
    saved_recipe_id: uuid().notNull(),
    changes: jsonb().$type<RecipeChanges>().notNull(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "recipe_modifications_saved_fk",
      columns: [t.saved_recipe_id, t.user_id],
      foreignColumns: [saved_recipes.id, saved_recipes.user_id],
    }).onDelete("cascade"),
    unique("recipe_modifications_saved_key").on(t.user_id, t.saved_recipe_id),
    index("recipe_modifications_user_idx").on(t.user_id),
    ...ownRows("recipe_modifications"),
  ],
);

export const recipe_notes = pgTable(
  "recipe_notes",
  {
    id: id(),
    user_id: userId(),
    saved_recipe_id: uuid().notNull(),
    text: text().notNull(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "recipe_notes_saved_fk",
      columns: [t.saved_recipe_id, t.user_id],
      foreignColumns: [saved_recipes.id, saved_recipes.user_id],
    }).onDelete("cascade"),
    index("recipe_notes_saved_idx").on(t.saved_recipe_id),
    index("recipe_notes_user_idx").on(t.user_id),
    ...ownRows("recipe_notes"),
  ],
);

/** A user's own photo or video of a recipe (stored in Supabase Storage, per-user folder). */
export const recipe_media = pgTable(
  "recipe_media",
  {
    id: id(),
    user_id: userId(),
    recipe_id: uuid().notNull(),
    kind: text().notNull(),
    storage_path: text().notNull(),
    created_at: createdAt(),
  },
  (t) => [
    foreignKey({ name: "recipe_media_recipe_fk", columns: [t.recipe_id], foreignColumns: [recipes.id] }).onDelete("cascade"),
    check("recipe_media_kind_check", sql`${t.kind} in (${list(MEDIA_KINDS)})`),
    // Objects live in a per-user folder: <user id>/<recipe id>/<file>.
    check("recipe_media_path_check", sql`starts_with(${t.storage_path}, ${t.user_id} || '/')`),
    unique("recipe_media_path_key").on(t.storage_path),
    index("recipe_media_recipe_idx").on(t.recipe_id, t.user_id),
    ...ownRows("recipe_media"),
  ],
);

export const collections = pgTable(
  "collections",
  {
    id: id(),
    user_id: userId(),
    name: text().notNull(),
    created_at: createdAt(),
  },
  (t) => [
    unique("collections_user_name_key").on(t.user_id, t.name),
    unique("collections_id_user_key").on(t.id, t.user_id),
    check("collections_name_check", sql`char_length(btrim(${t.name})) between 1 and 80`),
    ...ownRows("collections"),
  ],
);

export const collection_items = pgTable(
  "collection_items",
  {
    collection_id: uuid().notNull(),
    saved_recipe_id: uuid().notNull(),
    user_id: userId(),
    added_at: createdAt(),
  },
  (t) => [
    primaryKey({ name: "collection_items_pkey", columns: [t.collection_id, t.saved_recipe_id] }),
    foreignKey({
      name: "collection_items_collection_fk",
      columns: [t.collection_id, t.user_id],
      foreignColumns: [collections.id, collections.user_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "collection_items_saved_fk",
      columns: [t.saved_recipe_id, t.user_id],
      foreignColumns: [saved_recipes.id, saved_recipes.user_id],
    }).onDelete("cascade"),
    index("collection_items_user_idx").on(t.user_id),
    ...ownRows("collection_items"),
  ],
);

// ───────────────────────────────────────── kitchen ─────────────────────────────────────────

/** Quantity null = "have some" (no number). Quantity 0 = marked out. */
export const kitchen_items = pgTable(
  "kitchen_items",
  {
    id: id(),
    user_id: userId(),
    name: text().notNull(),
    normalized_name: text().notNull(),
    quantity: numeric({ mode: "number" }),
    unit: text(),
    location: text().notNull().default("pantry"),
    expires_at: date({ mode: "string" }),
    note: text(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    check("kitchen_items_location_check", sql`${t.location} in (${list(KITCHEN_LOCATIONS)})`),
    check("kitchen_items_quantity_check", sql`${t.quantity} is null or ${t.quantity} >= 0`),
    index("kitchen_items_user_idx").on(t.user_id, t.normalized_name),
    ...ownRows("kitchen_items"),
  ],
);

// ───────────────────────────────────────── plan ─────────────────────────────────────────

export const weekly_plans = pgTable(
  "weekly_plans",
  {
    id: id(),
    user_id: userId(),
    /** Always a Monday. */
    week_start_date: date({ mode: "string" }).notNull(),
    status: text().notNull().default("active"),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    unique("weekly_plans_user_week_key").on(t.user_id, t.week_start_date),
    unique("weekly_plans_id_user_key").on(t.id, t.user_id),
    check("weekly_plans_monday_check", sql`extract(isodow from ${t.week_start_date}) = 1`),
    check("weekly_plans_status_check", sql`${t.status} in (${list(PLAN_STATUSES)})`),
    ...ownRows("weekly_plans"),
  ],
);

export const planned_meals = pgTable(
  "planned_meals",
  {
    id: id(),
    user_id: userId(),
    weekly_plan_id: uuid().notNull(),
    saved_recipe_id: uuid().notNull(),
    planned_date: date({ mode: "string" }).notNull(),
    meal_type: text().notNull().default("dinner"),
    servings: integer().notNull(),
    sort_order: integer().notNull().default(0),
    created_at: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "planned_meals_plan_fk",
      columns: [t.weekly_plan_id, t.user_id],
      foreignColumns: [weekly_plans.id, weekly_plans.user_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "planned_meals_saved_fk",
      columns: [t.saved_recipe_id, t.user_id],
      foreignColumns: [saved_recipes.id, saved_recipes.user_id],
    }).onDelete("cascade"),
    unique("planned_meals_id_user_key").on(t.id, t.user_id),
    check("planned_meals_type_check", sql`${t.meal_type} in (${list(MEAL_TYPES)})`),
    check("planned_meals_servings_check", sql`${t.servings} between 1 and 99`),
    index("planned_meals_plan_idx").on(t.weekly_plan_id, t.planned_date, t.sort_order),
    index("planned_meals_user_idx").on(t.user_id),
    ...ownRows("planned_meals"),
  ],
);

// ───────────────────────────────────────── grocery ─────────────────────────────────────────

export const grocery_lists = pgTable(
  "grocery_lists",
  {
    id: id(),
    user_id: userId(),
    weekly_plan_id: uuid().notNull(),
    generated_at: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "grocery_lists_plan_fk",
      columns: [t.weekly_plan_id, t.user_id],
      foreignColumns: [weekly_plans.id, weekly_plans.user_id],
    }).onDelete("cascade"),
    unique("grocery_lists_plan_key").on(t.user_id, t.weekly_plan_id),
    unique("grocery_lists_id_user_key").on(t.id, t.user_id),
    ...ownRows("grocery_lists"),
  ],
);

export const grocery_list_items = pgTable(
  "grocery_list_items",
  {
    id: id(),
    user_id: userId(),
    grocery_list_id: uuid().notNull(),
    /** Stable identity across regenerations: normalized name + unit family. Null for custom items. */
    generation_key: text(),
    name: text().notNull(),
    normalized_name: text().notNull(),
    quantity: numeric({ mode: "number" }),
    unit: text(),
    /** Shown instead of quantity + unit when the recipe's original wording must be kept. */
    display_text: text(),
    section: text().notNull().default("Other"),
    is_custom: boolean().notNull().default(false),
    is_checked: boolean().notNull().default(false),
    is_already_owned: boolean().notNull().default(false),
    owned_reason: text(),
    /** Tombstone: a removed generated item stays removed when the list regenerates. */
    is_removed: boolean().notNull().default(false),
    /** A generated item the user changed — regeneration keeps their version. */
    is_edited: boolean().notNull().default(false),
    note: text(),
    created_at: createdAt(),
    /** Set explicitly by actions (client timestamp) so offline replays resolve last-write-wins. */
    updated_at: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "grocery_items_list_fk",
      columns: [t.grocery_list_id, t.user_id],
      foreignColumns: [grocery_lists.id, grocery_lists.user_id],
    }).onDelete("cascade"),
    unique("grocery_items_id_user_key").on(t.id, t.user_id),
    check("grocery_items_section_check", sql`${t.section} in (${list(GROCERY_SECTIONS)})`),
    check(
      "grocery_items_owned_reason_check",
      sql`${t.owned_reason} is null or ${t.owned_reason} in (${list(OWNED_REASONS)})`,
    ),
    index("grocery_items_list_idx").on(t.grocery_list_id),
    index("grocery_items_user_idx").on(t.user_id),
    ...ownRows("grocery_list_items"),
  ],
);

/** Traceability: which planned meal (and ingredient line) each grocery item came from. */
export const grocery_item_sources = pgTable(
  "grocery_item_sources",
  {
    id: id(),
    user_id: userId(),
    grocery_list_item_id: uuid().notNull(),
    planned_meal_id: uuid().notNull(),
    ingredient_id: uuid(),
    quantity: numeric({ mode: "number" }),
    unit: text(),
  },
  (t) => [
    foreignKey({
      name: "grocery_sources_item_fk",
      columns: [t.grocery_list_item_id, t.user_id],
      foreignColumns: [grocery_list_items.id, grocery_list_items.user_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "grocery_sources_meal_fk",
      columns: [t.planned_meal_id, t.user_id],
      foreignColumns: [planned_meals.id, planned_meals.user_id],
    }).onDelete("cascade"),
    foreignKey({ name: "grocery_sources_ingredient_fk", columns: [t.ingredient_id], foreignColumns: [ingredients.id] }).onDelete("set null"),
    index("grocery_sources_item_idx").on(t.grocery_list_item_id),
    index("grocery_sources_user_idx").on(t.user_id),
    ...ownRows("grocery_item_sources"),
  ],
);

// ───────────────────────────────────────── prep ─────────────────────────────────────────

export const prep_plans = pgTable(
  "prep_plans",
  {
    id: id(),
    user_id: userId(),
    weekly_plan_id: uuid().notNull(),
    prep_date: date({ mode: "string" }),
    estimated_minutes: integer().notNull().default(0),
    generated_at: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "prep_plans_plan_fk",
      columns: [t.weekly_plan_id, t.user_id],
      foreignColumns: [weekly_plans.id, weekly_plans.user_id],
    }).onDelete("cascade"),
    unique("prep_plans_plan_key").on(t.user_id, t.weekly_plan_id),
    unique("prep_plans_id_user_key").on(t.id, t.user_id),
    index("prep_plans_user_idx").on(t.user_id),
    ...ownRows("prep_plans"),
  ],
);

export const prep_tasks = pgTable(
  "prep_tasks",
  {
    id: id(),
    user_id: userId(),
    prep_plan_id: uuid().notNull(),
    /** Stable identity across regenerations, e.g. "cut:onion", "grain:rice". Null for custom tasks. */
    generation_key: text(),
    title: text().notNull(),
    description: text(),
    minutes: integer().notNull().default(0),
    /** Mostly hands-off (rice, roasting): the cook can work on other tasks while it runs. */
    is_passive: boolean().notNull().default(false),
    sort_order: integer().notNull().default(0),
    is_completed: boolean().notNull().default(false),
    completed_at: tstz(),
    is_custom: boolean().notNull().default(false),
    /** A generated task the user changed — regeneration keeps their version. */
    is_edited: boolean().notNull().default(false),
    created_at: createdAt(),
    /** Set explicitly by actions (client timestamp) so offline replays resolve last-write-wins. */
    updated_at: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "prep_tasks_plan_fk",
      columns: [t.prep_plan_id, t.user_id],
      foreignColumns: [prep_plans.id, prep_plans.user_id],
    }).onDelete("cascade"),
    unique("prep_tasks_id_user_key").on(t.id, t.user_id),
    check("prep_tasks_minutes_check", sql`${t.minutes} >= 0`),
    index("prep_tasks_plan_idx").on(t.prep_plan_id, t.sort_order),
    index("prep_tasks_user_idx").on(t.user_id),
    ...ownRows("prep_tasks"),
  ],
);

/** Which planned meals each prep task serves ("used in"). */
export const prep_task_meals = pgTable(
  "prep_task_meals",
  {
    prep_task_id: uuid().notNull(),
    planned_meal_id: uuid().notNull(),
    user_id: userId(),
  },
  (t) => [
    primaryKey({ name: "prep_task_meals_pkey", columns: [t.prep_task_id, t.planned_meal_id] }),
    foreignKey({
      name: "prep_task_meals_task_fk",
      columns: [t.prep_task_id, t.user_id],
      foreignColumns: [prep_tasks.id, prep_tasks.user_id],
    }).onDelete("cascade"),
    foreignKey({
      name: "prep_task_meals_meal_fk",
      columns: [t.planned_meal_id, t.user_id],
      foreignColumns: [planned_meals.id, planned_meals.user_id],
    }).onDelete("cascade"),
    index("prep_task_meals_meal_idx").on(t.planned_meal_id),
    index("prep_task_meals_user_idx").on(t.user_id),
    ...ownRows("prep_task_meals"),
  ],
);

/** Every manual prep edit, logged as signal for a later AI grouping pass. */
export const prep_edit_log = pgTable(
  "prep_edit_log",
  {
    id: id(),
    user_id: userId(),
    prep_plan_id: uuid(),
    prep_task_id: uuid(),
    action: text().notNull(),
    before: jsonb().$type<PrepEditSnapshot | null>(),
    after: jsonb().$type<PrepEditSnapshot | null>(),
    created_at: createdAt(),
  },
  (t) => [
    check(
      "prep_edit_log_action_check",
      sql`${t.action} in ('add', 'edit', 'delete', 'reorder', 'complete', 'uncomplete', 'change_day')`,
    ),
    index("prep_edit_log_user_idx").on(t.user_id, t.created_at),
    pgPolicy("prep_edit_log: select own", { for: "select", to: authenticated, using: sql`user_id = ${sub}` }),
    pgPolicy("prep_edit_log: insert own", { for: "insert", to: authenticated, withCheck: sql`user_id = ${sub}` }),
  ],
);

// ───────────────────────────────────────── cook ─────────────────────────────────────────

export const cooking_events = pgTable(
  "cooking_events",
  {
    id: id(),
    user_id: userId(),
    saved_recipe_id: uuid().notNull(),
    planned_meal_id: uuid(),
    cooked_at: tstz().notNull().defaultNow(),
    rating: smallint(),
    note: text(),
  },
  (t) => [
    foreignKey({
      name: "cooking_events_saved_fk",
      columns: [t.saved_recipe_id, t.user_id],
      foreignColumns: [saved_recipes.id, saved_recipes.user_id],
    }).onDelete("cascade"),
    foreignKey({ name: "cooking_events_meal_fk", columns: [t.planned_meal_id], foreignColumns: [planned_meals.id] }).onDelete("set null"),
    check("cooking_events_rating_check", sql`${t.rating} is null or ${t.rating} between 1 and 5`),
    index("cooking_events_saved_idx").on(t.saved_recipe_id, t.cooked_at),
    index("cooking_events_user_idx").on(t.user_id),
    ...ownRows("cooking_events"),
  ],
);

// ───────────────────────────────────────── push ─────────────────────────────────────────

export const push_subscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    user_id: userId(),
    endpoint: text().notNull(),
    keys: jsonb().$type<{ p256dh: string; auth: string }>().notNull(),
    user_agent: text(),
    created_at: createdAt(),
  },
  (t) => [
    unique("push_subscriptions_endpoint_key").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.user_id),
    ...ownRows("push_subscriptions"),
  ],
);

/** Dedupes reminders so a cron retry never notifies twice. Service role only — no client policies. */
export const push_deliveries = pgTable(
  "push_deliveries",
  {
    user_id: text().notNull(),
    kind: text().notNull(),
    local_date: date({ mode: "string" }).notNull(),
    sent_at: createdAt(),
  },
  (t) => [
    primaryKey({ name: "push_deliveries_pkey", columns: [t.user_id, t.kind, t.local_date] }),
    check("push_deliveries_kind_check", sql`${t.kind} in ('prep_day', 'tonights_dinner')`),
  ],
).enableRLS();
