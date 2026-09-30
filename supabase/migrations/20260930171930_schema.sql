CREATE TABLE "collection_items" (
	"collection_id" uuid NOT NULL,
	"saved_recipe_id" uuid NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_items_pkey" PRIMARY KEY("collection_id","saved_recipe_id")
);
--> statement-breakpoint
ALTER TABLE "collection_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_user_name_key" UNIQUE("user_id","name"),
	CONSTRAINT "collections_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "collections_name_check" CHECK (char_length(btrim("collections"."name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cooking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"saved_recipe_id" uuid NOT NULL,
	"planned_meal_id" uuid,
	"cooked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rating" smallint,
	"note" text,
	CONSTRAINT "cooking_events_rating_check" CHECK ("cooking_events"."rating" is null or "cooking_events"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "cooking_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grocery_item_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"grocery_list_item_id" uuid NOT NULL,
	"planned_meal_id" uuid NOT NULL,
	"ingredient_id" uuid,
	"quantity" numeric,
	"unit" text
);
--> statement-breakpoint
ALTER TABLE "grocery_item_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grocery_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"grocery_list_id" uuid NOT NULL,
	"generation_key" text,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"quantity" numeric,
	"unit" text,
	"display_text" text,
	"section" text DEFAULT 'Other' NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"is_checked" boolean DEFAULT false NOT NULL,
	"is_already_owned" boolean DEFAULT false NOT NULL,
	"owned_reason" text,
	"is_removed" boolean DEFAULT false NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grocery_items_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "grocery_items_section_check" CHECK ("grocery_list_items"."section" in ('Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Frozen', 'Other')),
	CONSTRAINT "grocery_items_owned_reason_check" CHECK ("grocery_list_items"."owned_reason" is null or "grocery_list_items"."owned_reason" in ('kitchen', 'assumed', 'user'))
);
--> statement-breakpoint
ALTER TABLE "grocery_list_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grocery_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"weekly_plan_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grocery_lists_plan_key" UNIQUE("user_id","weekly_plan_id"),
	CONSTRAINT "grocery_lists_id_user_key" UNIQUE("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "grocery_lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"owner_id" text DEFAULT (auth.jwt() ->> 'sub'),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"quantity" numeric,
	"quantity_max" numeric,
	"unit" text,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"preparation" text,
	"raw_text" text NOT NULL,
	"grocery_section" text DEFAULT 'Other' NOT NULL,
	"group_label" text,
	CONSTRAINT "ingredients_section_check" CHECK ("ingredients"."grocery_section" in ('Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Frozen', 'Other'))
);
--> statement-breakpoint
ALTER TABLE "ingredients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kitchen_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"quantity" numeric,
	"unit" text,
	"location" text DEFAULT 'pantry' NOT NULL,
	"expires_at" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kitchen_items_location_check" CHECK ("kitchen_items"."location" in ('pantry', 'fridge', 'freezer', 'other')),
	CONSTRAINT "kitchen_items_quantity_check" CHECK ("kitchen_items"."quantity" is null or "kitchen_items"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "kitchen_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"weekly_plan_id" uuid NOT NULL,
	"saved_recipe_id" uuid NOT NULL,
	"planned_date" date NOT NULL,
	"meal_type" text DEFAULT 'dinner' NOT NULL,
	"servings" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_meals_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "planned_meals_type_check" CHECK ("planned_meals"."meal_type" in ('breakfast', 'lunch', 'dinner', 'snack')),
	CONSTRAINT "planned_meals_servings_check" CHECK ("planned_meals"."servings" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "planned_meals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prep_edit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"prep_plan_id" uuid,
	"prep_task_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prep_edit_log_action_check" CHECK ("prep_edit_log"."action" in ('add', 'edit', 'delete', 'reorder', 'complete', 'uncomplete', 'change_day'))
);
--> statement-breakpoint
ALTER TABLE "prep_edit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prep_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"weekly_plan_id" uuid NOT NULL,
	"prep_date" date,
	"estimated_minutes" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prep_plans_plan_key" UNIQUE("user_id","weekly_plan_id"),
	CONSTRAINT "prep_plans_id_user_key" UNIQUE("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "prep_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prep_task_meals" (
	"prep_task_id" uuid NOT NULL,
	"planned_meal_id" uuid NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	CONSTRAINT "prep_task_meals_pkey" PRIMARY KEY("prep_task_id","planned_meal_id")
);
--> statement-breakpoint
ALTER TABLE "prep_task_meals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prep_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"prep_plan_id" uuid NOT NULL,
	"generation_key" text,
	"title" text NOT NULL,
	"description" text,
	"minutes" integer DEFAULT 0 NOT NULL,
	"is_passive" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"is_custom" boolean DEFAULT false NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prep_tasks_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "prep_tasks_minutes_check" CHECK ("prep_tasks"."minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "prep_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"email" text,
	"name" text,
	"stripe_customer_id" text,
	"prep_day" smallint DEFAULT 7 NOT NULL,
	"reminder_time" time DEFAULT '17:00:00' NOT NULL,
	"timezone" text,
	"remind_prep" boolean DEFAULT true NOT NULL,
	"remind_dinner" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "profiles_prep_day_check" CHECK ("profiles"."prep_day" between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_deliveries" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"local_date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_deliveries_pkey" PRIMARY KEY("user_id","kind","local_date"),
	CONSTRAINT "push_deliveries_kind_check" CHECK ("push_deliveries"."kind" in ('prep_day', 'tonights_dinner'))
);
--> statement-breakpoint
ALTER TABLE "push_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"recipe_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_media_path_key" UNIQUE("storage_path"),
	CONSTRAINT "recipe_media_kind_check" CHECK ("recipe_media"."kind" in ('photo', 'video')),
	CONSTRAINT "recipe_media_path_check" CHECK (starts_with("recipe_media"."storage_path", "recipe_media"."user_id" || '/'))
);
--> statement-breakpoint
ALTER TABLE "recipe_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_modifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"saved_recipe_id" uuid NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_modifications_saved_key" UNIQUE("user_id","saved_recipe_id")
);
--> statement-breakpoint
ALTER TABLE "recipe_modifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"saved_recipe_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"owner_id" text DEFAULT (auth.jwt() ->> 'sub'),
	"step_number" integer NOT NULL,
	"instruction" text NOT NULL,
	CONSTRAINT "recipe_steps_recipe_step_key" UNIQUE NULLS NOT DISTINCT("recipe_id","owner_id","step_number")
);
--> statement-breakpoint
ALTER TABLE "recipe_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"slug" text,
	"title" text NOT NULL,
	"author" text,
	"headnote" text,
	"image_url" text,
	"prep_minutes" integer,
	"cook_minutes" integer,
	"total_minutes" integer,
	"servings" integer,
	"servings_label" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"owner_id" text DEFAULT (auth.jwt() ->> 'sub'),
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_id_owner_key" UNIQUE("id","owner_id"),
	CONSTRAINT "recipes_source_check" CHECK ("recipes"."source" in ('seeded', 'url_import', 'manual')),
	CONSTRAINT "recipes_owner_check" CHECK (("recipes"."source" = 'seeded' and "recipes"."owner_id" is null) or ("recipes"."source" <> 'seeded' and "recipes"."owner_id" is not null)),
	CONSTRAINT "recipes_servings_check" CHECK ("recipes"."servings" is null or "recipes"."servings" between 1 and 999)
);
--> statement-breakpoint
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"recipe_id" uuid NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"personal_rating" smallint,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_recipes_user_recipe_key" UNIQUE("user_id","recipe_id"),
	CONSTRAINT "saved_recipes_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "saved_recipes_rating_check" CHECK ("saved_recipes"."personal_rating" is null or "saved_recipes"."personal_rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "saved_recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"status" text NOT NULL,
	"plan" text,
	"price_id" text,
	"current_period_end" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_pkey" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "usage_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "weekly_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT (auth.jwt() ->> 'sub') NOT NULL,
	"week_start_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_plans_user_week_key" UNIQUE("user_id","week_start_date"),
	CONSTRAINT "weekly_plans_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "weekly_plans_monday_check" CHECK (extract(isodow from "weekly_plans"."week_start_date") = 1),
	CONSTRAINT "weekly_plans_status_check" CHECK ("weekly_plans"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "weekly_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_fk" FOREIGN KEY ("collection_id","user_id") REFERENCES "public"."collections"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_saved_fk" FOREIGN KEY ("saved_recipe_id","user_id") REFERENCES "public"."saved_recipes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooking_events" ADD CONSTRAINT "cooking_events_saved_fk" FOREIGN KEY ("saved_recipe_id","user_id") REFERENCES "public"."saved_recipes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cooking_events" ADD CONSTRAINT "cooking_events_meal_fk" FOREIGN KEY ("planned_meal_id") REFERENCES "public"."planned_meals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_item_sources" ADD CONSTRAINT "grocery_sources_item_fk" FOREIGN KEY ("grocery_list_item_id","user_id") REFERENCES "public"."grocery_list_items"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_item_sources" ADD CONSTRAINT "grocery_sources_meal_fk" FOREIGN KEY ("planned_meal_id","user_id") REFERENCES "public"."planned_meals"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_item_sources" ADD CONSTRAINT "grocery_sources_ingredient_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_list_items" ADD CONSTRAINT "grocery_items_list_fk" FOREIGN KEY ("grocery_list_id","user_id") REFERENCES "public"."grocery_lists"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_lists" ADD CONSTRAINT "grocery_lists_plan_fk" FOREIGN KEY ("weekly_plan_id","user_id") REFERENCES "public"."weekly_plans"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_recipe_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_recipe_owner_fk" FOREIGN KEY ("recipe_id","owner_id") REFERENCES "public"."recipes"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_meals" ADD CONSTRAINT "planned_meals_plan_fk" FOREIGN KEY ("weekly_plan_id","user_id") REFERENCES "public"."weekly_plans"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_meals" ADD CONSTRAINT "planned_meals_saved_fk" FOREIGN KEY ("saved_recipe_id","user_id") REFERENCES "public"."saved_recipes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_plans" ADD CONSTRAINT "prep_plans_plan_fk" FOREIGN KEY ("weekly_plan_id","user_id") REFERENCES "public"."weekly_plans"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_task_meals" ADD CONSTRAINT "prep_task_meals_task_fk" FOREIGN KEY ("prep_task_id","user_id") REFERENCES "public"."prep_tasks"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_task_meals" ADD CONSTRAINT "prep_task_meals_meal_fk" FOREIGN KEY ("planned_meal_id","user_id") REFERENCES "public"."planned_meals"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_tasks" ADD CONSTRAINT "prep_tasks_plan_fk" FOREIGN KEY ("prep_plan_id","user_id") REFERENCES "public"."prep_plans"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_media" ADD CONSTRAINT "recipe_media_recipe_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_modifications" ADD CONSTRAINT "recipe_modifications_saved_fk" FOREIGN KEY ("saved_recipe_id","user_id") REFERENCES "public"."saved_recipes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_notes" ADD CONSTRAINT "recipe_notes_saved_fk" FOREIGN KEY ("saved_recipe_id","user_id") REFERENCES "public"."saved_recipes"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipe_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipe_owner_fk" FOREIGN KEY ("recipe_id","owner_id") REFERENCES "public"."recipes"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_recipes" ADD CONSTRAINT "saved_recipes_recipe_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_items_user_idx" ON "collection_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cooking_events_saved_idx" ON "cooking_events" USING btree ("saved_recipe_id","cooked_at");--> statement-breakpoint
CREATE INDEX "cooking_events_user_idx" ON "cooking_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "grocery_sources_item_idx" ON "grocery_item_sources" USING btree ("grocery_list_item_id");--> statement-breakpoint
CREATE INDEX "grocery_sources_user_idx" ON "grocery_item_sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "grocery_items_list_idx" ON "grocery_list_items" USING btree ("grocery_list_id");--> statement-breakpoint
CREATE INDEX "grocery_items_user_idx" ON "grocery_list_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ingredients_recipe_idx" ON "ingredients" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "kitchen_items_user_idx" ON "kitchen_items" USING btree ("user_id","normalized_name");--> statement-breakpoint
CREATE INDEX "planned_meals_plan_idx" ON "planned_meals" USING btree ("weekly_plan_id","planned_date","sort_order");--> statement-breakpoint
CREATE INDEX "planned_meals_user_idx" ON "planned_meals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prep_edit_log_user_idx" ON "prep_edit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "prep_plans_user_idx" ON "prep_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prep_task_meals_meal_idx" ON "prep_task_meals" USING btree ("planned_meal_id");--> statement-breakpoint
CREATE INDEX "prep_task_meals_user_idx" ON "prep_task_meals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prep_tasks_plan_idx" ON "prep_tasks" USING btree ("prep_plan_id","sort_order");--> statement-breakpoint
CREATE INDEX "prep_tasks_user_idx" ON "prep_tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recipe_media_recipe_idx" ON "recipe_media" USING btree ("recipe_id","user_id");--> statement-breakpoint
CREATE INDEX "recipe_modifications_user_idx" ON "recipe_modifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recipe_notes_saved_idx" ON "recipe_notes" USING btree ("saved_recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_notes_user_idx" ON "recipe_notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recipe_steps_recipe_idx" ON "recipe_steps" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_seeded_slug_key" ON "recipes" USING btree ("slug") WHERE "recipes"."source" = 'seeded';--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_import_url_key" ON "recipes" USING btree ("owner_id","source_url") WHERE "recipes"."source" = 'url_import';--> statement-breakpoint
CREATE INDEX "recipes_owner_idx" ON "recipes" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "saved_recipes_user_idx" ON "saved_recipes" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "collection_items: select own" ON "collection_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "collection_items: insert own" ON "collection_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "collection_items: update own" ON "collection_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "collection_items: delete own" ON "collection_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "collections: select own" ON "collections" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "collections: insert own" ON "collections" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "collections: update own" ON "collections" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "collections: delete own" ON "collections" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "cooking_events: select own" ON "cooking_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "cooking_events: insert own" ON "cooking_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "cooking_events: update own" ON "cooking_events" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "cooking_events: delete own" ON "cooking_events" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_item_sources: select own" ON "grocery_item_sources" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_item_sources: insert own" ON "grocery_item_sources" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_item_sources: update own" ON "grocery_item_sources" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_item_sources: delete own" ON "grocery_item_sources" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_list_items: select own" ON "grocery_list_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_list_items: insert own" ON "grocery_list_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_list_items: update own" ON "grocery_list_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_list_items: delete own" ON "grocery_list_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_lists: select own" ON "grocery_lists" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_lists: insert own" ON "grocery_lists" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_lists: update own" ON "grocery_lists" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "grocery_lists: delete own" ON "grocery_lists" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "ingredients: select catalog or own" ON "ingredients" AS PERMISSIVE FOR SELECT TO "authenticated" USING (owner_id is null or owner_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "ingredients: insert own" ON "ingredients" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (owner_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "ingredients: update own" ON "ingredients" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (owner_id = (select auth.jwt() ->> 'sub')) WITH CHECK (owner_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "ingredients: delete own" ON "ingredients" AS PERMISSIVE FOR DELETE TO "authenticated" USING (owner_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "kitchen_items: select own" ON "kitchen_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "kitchen_items: insert own" ON "kitchen_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "kitchen_items: update own" ON "kitchen_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "kitchen_items: delete own" ON "kitchen_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "planned_meals: select own" ON "planned_meals" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "planned_meals: insert own" ON "planned_meals" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "planned_meals: update own" ON "planned_meals" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "planned_meals: delete own" ON "planned_meals" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_edit_log: select own" ON "prep_edit_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_edit_log: insert own" ON "prep_edit_log" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_plans: select own" ON "prep_plans" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_plans: insert own" ON "prep_plans" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_plans: update own" ON "prep_plans" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_plans: delete own" ON "prep_plans" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_task_meals: select own" ON "prep_task_meals" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_task_meals: insert own" ON "prep_task_meals" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_task_meals: update own" ON "prep_task_meals" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_task_meals: delete own" ON "prep_task_meals" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_tasks: select own" ON "prep_tasks" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_tasks: insert own" ON "prep_tasks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_tasks: update own" ON "prep_tasks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "prep_tasks: delete own" ON "prep_tasks" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "profiles: select own" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "profiles: insert own" ON "profiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "profiles: update own" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "push_subscriptions: select own" ON "push_subscriptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "push_subscriptions: insert own" ON "push_subscriptions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "push_subscriptions: update own" ON "push_subscriptions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "push_subscriptions: delete own" ON "push_subscriptions" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_media: select own" ON "recipe_media" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_media: insert own" ON "recipe_media" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_media: update own" ON "recipe_media" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_media: delete own" ON "recipe_media" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_modifications: select own" ON "recipe_modifications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_modifications: insert own" ON "recipe_modifications" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_modifications: update own" ON "recipe_modifications" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_modifications: delete own" ON "recipe_modifications" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_notes: select own" ON "recipe_notes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_notes: insert own" ON "recipe_notes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_notes: update own" ON "recipe_notes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_notes: delete own" ON "recipe_notes" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_steps: select catalog or own" ON "recipe_steps" AS PERMISSIVE FOR SELECT TO "authenticated" USING (owner_id is null or owner_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_steps: insert own" ON "recipe_steps" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (owner_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_steps: update own" ON "recipe_steps" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (owner_id = (select auth.jwt() ->> 'sub')) WITH CHECK (owner_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipe_steps: delete own" ON "recipe_steps" AS PERMISSIVE FOR DELETE TO "authenticated" USING (owner_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipes: select catalog or own" ON "recipes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((source = 'seeded' and published_at is not null) or owner_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "recipes: insert own" ON "recipes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (owner_id = (select auth.jwt() ->> 'sub') and source in ('url_import', 'manual'));--> statement-breakpoint
CREATE POLICY "recipes: update own" ON "recipes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (owner_id = (select auth.jwt() ->> 'sub') and source <> 'seeded') WITH CHECK (owner_id = (select auth.jwt() ->> 'sub') and source <> 'seeded');--> statement-breakpoint
CREATE POLICY "recipes: delete own" ON "recipes" AS PERMISSIVE FOR DELETE TO "authenticated" USING (owner_id = (select auth.jwt() ->> 'sub') and source <> 'seeded');--> statement-breakpoint
CREATE POLICY "saved_recipes: select own" ON "saved_recipes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "saved_recipes: insert own" ON "saved_recipes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "saved_recipes: update own" ON "saved_recipes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "saved_recipes: delete own" ON "saved_recipes" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "subscriptions: select own" ON "subscriptions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "usage_counters: select own" ON "usage_counters" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "weekly_plans: select own" ON "weekly_plans" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "weekly_plans: insert own" ON "weekly_plans" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "weekly_plans: update own" ON "weekly_plans" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub')) WITH CHECK (user_id = (select auth.jwt() ->> 'sub'));--> statement-breakpoint
CREATE POLICY "weekly_plans: delete own" ON "weekly_plans" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.jwt() ->> 'sub'));