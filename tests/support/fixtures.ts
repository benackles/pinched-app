import { asService, type Db } from "./db";

export const ALICE = "user_alice";
export const BOB = "user_bob";

/** Fixed ids so assertions read clearly. All valid v4-shaped UUIDs. */
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ids = {
  // recipes
  seededPublished: id(1),
  seededDraft: id(2),
  aliceRecipe: id(3),
  bobRecipe: id(4),
  // alice
  aliceSaved: id(10),
  aliceSavedOwn: id(11),
  alicePlan: id(12),
  aliceMeal: id(13),
  aliceList: id(14),
  aliceItem: id(15),
  alicePrepPlan: id(16),
  alicePrepTask: id(17),
  aliceCollection: id(18),
  // bob
  bobSaved: id(20),
  bobPlan: id(22),
  bobMeal: id(23),
  bobList: id(24),
  bobItem: id(25),
  bobPrepPlan: id(26),
  bobPrepTask: id(27),
  bobCollection: id(28),
};

/**
 * Two tenants with a full slice of data each, plus a published and a draft catalog recipe.
 * Inserted as the service role (the way seeds and webhooks do).
 */
export async function seedTwoTenants(db: Db): Promise<void> {
  await asService(db, async (tx) => {
    await tx.exec(`
      insert into recipes (id, source, slug, title, owner_id, published_at, servings) values
        ('${ids.seededPublished}', 'seeded', 'published', 'Published catalog recipe', null, now(), 4),
        ('${ids.seededDraft}', 'seeded', 'draft', 'Draft catalog recipe', null, null, 4),
        ('${ids.aliceRecipe}', 'manual', null, 'Alice private recipe', '${ALICE}', null, 2),
        ('${ids.bobRecipe}', 'manual', null, 'Bob private recipe', '${BOB}', null, 2);

      insert into ingredients (recipe_id, owner_id, sort_order, name, normalized_name, raw_text, grocery_section) values
        ('${ids.seededPublished}', null, 0, 'yellow onion', 'onion', '1 yellow onion', 'Produce'),
        ('${ids.seededDraft}', null, 0, 'secret spice', 'secret spice', '1 tsp secret spice', 'Pantry'),
        ('${ids.aliceRecipe}', '${ALICE}', 0, 'rice', 'rice', '1 cup rice', 'Pantry'),
        ('${ids.bobRecipe}', '${BOB}', 0, 'beans', 'bean', '1 can beans', 'Pantry');
      insert into recipe_steps (recipe_id, owner_id, step_number, instruction) values
        ('${ids.seededPublished}', null, 1, 'Dice the onion.'),
        ('${ids.seededDraft}', null, 1, 'Draft step.'),
        ('${ids.aliceRecipe}', '${ALICE}', 1, 'Cook the rice.'),
        ('${ids.bobRecipe}', '${BOB}', 1, 'Heat the beans.');

      insert into profiles (user_id, email, name, stripe_customer_id) values
        ('${ALICE}', 'alice@example.test', 'Alice', 'cus_alice'),
        ('${BOB}', 'bob@example.test', 'Bob', 'cus_bob');
      insert into subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status, plan, current_period_end) values
        ('${ALICE}', 'sub_alice', 'cus_alice', 'active', 'monthly', now() + interval '20 days'),
        ('${BOB}', 'sub_bob', 'cus_bob', 'canceled', 'monthly', now() - interval '10 days');
      insert into usage_counters (user_id, key, count) values
        ('${ALICE}', 'url_import:2026-09', 2), ('${BOB}', 'url_import:2026-09', 4);

      insert into saved_recipes (id, user_id, recipe_id) values
        ('${ids.aliceSaved}', '${ALICE}', '${ids.seededPublished}'),
        ('${ids.aliceSavedOwn}', '${ALICE}', '${ids.aliceRecipe}'),
        ('${ids.bobSaved}', '${BOB}', '${ids.seededPublished}');
      insert into weekly_plans (id, user_id, week_start_date) values
        ('${ids.alicePlan}', '${ALICE}', '2026-09-28'),
        ('${ids.bobPlan}', '${BOB}', '2026-09-28');
      insert into planned_meals (id, user_id, weekly_plan_id, saved_recipe_id, planned_date, meal_type, servings) values
        ('${ids.aliceMeal}', '${ALICE}', '${ids.alicePlan}', '${ids.aliceSaved}', '2026-09-29', 'dinner', 4),
        ('${ids.bobMeal}', '${BOB}', '${ids.bobPlan}', '${ids.bobSaved}', '2026-09-29', 'dinner', 2);
      insert into grocery_lists (id, user_id, weekly_plan_id) values
        ('${ids.aliceList}', '${ALICE}', '${ids.alicePlan}'),
        ('${ids.bobList}', '${BOB}', '${ids.bobPlan}');
      insert into grocery_list_items (id, user_id, grocery_list_id, name, normalized_name) values
        ('${ids.aliceItem}', '${ALICE}', '${ids.aliceList}', 'onion', 'onion'),
        ('${ids.bobItem}', '${BOB}', '${ids.bobList}', 'onion', 'onion');
      insert into grocery_item_sources (user_id, grocery_list_item_id, planned_meal_id) values
        ('${ALICE}', '${ids.aliceItem}', '${ids.aliceMeal}'),
        ('${BOB}', '${ids.bobItem}', '${ids.bobMeal}');
      insert into prep_plans (id, user_id, weekly_plan_id) values
        ('${ids.alicePrepPlan}', '${ALICE}', '${ids.alicePlan}'),
        ('${ids.bobPrepPlan}', '${BOB}', '${ids.bobPlan}');
      insert into prep_tasks (id, user_id, prep_plan_id, title) values
        ('${ids.alicePrepTask}', '${ALICE}', '${ids.alicePrepPlan}', 'Dice onions'),
        ('${ids.bobPrepTask}', '${BOB}', '${ids.bobPrepPlan}', 'Dice onions');
      insert into prep_task_meals (prep_task_id, planned_meal_id, user_id) values
        ('${ids.alicePrepTask}', '${ids.aliceMeal}', '${ALICE}'),
        ('${ids.bobPrepTask}', '${ids.bobMeal}', '${BOB}');
      insert into prep_edit_log (user_id, action) values ('${ALICE}', 'add'), ('${BOB}', 'add');
      insert into kitchen_items (user_id, name, normalized_name) values
        ('${ALICE}', 'Rice', 'rice'), ('${BOB}', 'Flour', 'flour');
      insert into collections (id, user_id, name) values
        ('${ids.aliceCollection}', '${ALICE}', 'Weeknights'),
        ('${ids.bobCollection}', '${BOB}', 'Weeknights');
      insert into collection_items (collection_id, saved_recipe_id, user_id) values
        ('${ids.aliceCollection}', '${ids.aliceSaved}', '${ALICE}'),
        ('${ids.bobCollection}', '${ids.bobSaved}', '${BOB}');
      insert into recipe_notes (user_id, saved_recipe_id, text) values
        ('${ALICE}', '${ids.aliceSaved}', 'less salt'), ('${BOB}', '${ids.bobSaved}', 'more garlic');
      insert into recipe_modifications (user_id, saved_recipe_id, changes) values
        ('${ALICE}', '${ids.aliceSaved}', '{"title":"Alice version"}'),
        ('${BOB}', '${ids.bobSaved}', '{"title":"Bob version"}');
      insert into cooking_events (user_id, saved_recipe_id, planned_meal_id, rating) values
        ('${ALICE}', '${ids.aliceSaved}', '${ids.aliceMeal}', 5),
        ('${BOB}', '${ids.bobSaved}', '${ids.bobMeal}', 3);
      insert into push_subscriptions (user_id, endpoint, keys) values
        ('${ALICE}', 'https://push.example/alice', '{"p256dh":"a","auth":"a"}'),
        ('${BOB}', 'https://push.example/bob', '{"p256dh":"b","auth":"b"}');
      insert into recipe_media (user_id, recipe_id, kind, storage_path) values
        ('${ALICE}', '${ids.seededPublished}', 'photo', '${ALICE}/published/a.jpg'),
        ('${BOB}', '${ids.seededPublished}', 'photo', '${BOB}/published/b.jpg');
    `);
  });
}

/** Tables keyed by `user_id`, with a column safe to set in an UPDATE for the tamper tests. */
export const TENANT_TABLES: { table: string; touch: string }[] = [
  { table: "profiles", touch: "name = 'hacked'" },
  { table: "subscriptions", touch: "plan = 'hacked'" },
  { table: "usage_counters", touch: "count = 0" },
  { table: "saved_recipes", touch: "favorite = true" },
  { table: "recipe_modifications", touch: `changes = '{"title":"hacked"}'` },
  { table: "recipe_notes", touch: "text = 'hacked'" },
  { table: "recipe_media", touch: "kind = 'video'" },
  { table: "collections", touch: "name = 'hacked'" },
  { table: "collection_items", touch: "added_at = now()" },
  { table: "kitchen_items", touch: "name = 'hacked'" },
  { table: "weekly_plans", touch: "status = 'archived'" },
  { table: "planned_meals", touch: "servings = 99" },
  { table: "grocery_lists", touch: "generated_at = now()" },
  { table: "grocery_list_items", touch: "name = 'hacked'" },
  { table: "grocery_item_sources", touch: "quantity = 99" },
  { table: "prep_plans", touch: "estimated_minutes = 999" },
  { table: "prep_tasks", touch: "title = 'hacked'" },
  { table: "prep_task_meals", touch: "user_id = user_id" },
  { table: "prep_edit_log", touch: "action = 'edit'" },
  { table: "cooking_events", touch: "rating = 1" },
  { table: "push_subscriptions", touch: "user_agent = 'hacked'" },
];
