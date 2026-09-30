import { Logo } from "@/components/brand/logo";

// Placeholder — replaced by the marketing page once the shell is verified.
export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-24 text-center">
      <Logo className="text-5xl" />
      <h1 className="mt-6 text-5xl font-semibold md:text-7xl">
        Plan the week. <span className="text-primary italic">Prep once.</span> Cook faster.
      </h1>
    </main>
  );
}
