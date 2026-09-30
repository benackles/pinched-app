import { CalendarDays, ChefHat, Refrigerator, ShoppingBasket } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { SIGN_IN, SIGN_UP } from "@/lib/routes";
import { getSession } from "@/server/auth";

const STEPS = [
  { icon: CalendarDays, title: "Plan the week", body: "Drop recipes onto Monday through Sunday." },
  {
    icon: Refrigerator,
    title: "Check the kitchen",
    body: "Tell Pinched what's already in the pantry and fridge.",
  },
  {
    icon: ShoppingBasket,
    title: "Shop for the gap",
    body: "One grocery list, minus what you own.",
  },
  {
    icon: ChefHat,
    title: "Prep once",
    body: "Overlapping chopping and cooking, combined into one session.",
  },
] as const;

export default async function Home() {
  // Signed-in people land on their week.
  if (await getSession()) redirect("/plan");

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" aria-label="Pinched home">
          <Logo />
        </Link>
        <Link href={SIGN_IN} className={buttonVariants({ variant: "ghost" })}>
          Sign in
        </Link>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 md:grid-cols-2 md:py-16">
          <div>
            <h1 className="text-5xl leading-[1.05] font-semibold md:text-7xl">
              Plan the week. <span className="text-primary italic">Prep once.</span> Cook faster.
            </h1>
            <p className="mt-6 max-w-md text-lg text-muted-foreground">
              Pinched turns a handful of recipes into one grocery list of only what you&apos;re
              missing, and one practical prep session for the whole week.
            </p>
            <div className="mt-8 flex gap-3">
              <Link href={SIGN_UP} className={buttonVariants({ size: "lg" })}>
                Start planning
              </Link>
            </div>
          </div>
          <img
            src="/images/hero-prep.svg"
            alt="Glass meal-prep containers of rice, roasted sweet potatoes and chopped onions"
            width={1600}
            height={1200}
            fetchPriority="high"
            className="aspect-[4/3] w-full rounded-3xl object-cover shadow-lift"
          />
        </section>

        <section
          aria-label="How Pinched works"
          className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:grid-cols-2 lg:grid-cols-4"
        >
          {STEPS.map((step) => (
            <div key={step.title} className="rounded-2xl bg-card p-6 shadow-card">
              <step.icon className="size-6 text-primary-strong" aria-hidden />
              <h2 className="mt-4 text-xl font-semibold">{step.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
