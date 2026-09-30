/** Shown when neither Clerk nor local mode is configured, so a misconfigured deploy explains itself. */
export function SetupNeeded() {
  return (
    <div className="w-full max-w-md rounded-3xl bg-card p-8 shadow-lift">
      <h1 className="text-3xl font-semibold">Sign-in isn&apos;t set up yet</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This deployment has no identity provider configured. To run Pinched, either:
      </p>
      <ul className="mt-4 space-y-3 text-sm">
        <li>
          <strong>Try it locally, no accounts:</strong> run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">pnpm dev:local</code>.
        </li>
        <li>
          <strong>Deploy for real:</strong> set{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>{" "}
          and <code className="rounded bg-muted px-1.5 py-0.5">CLERK_SECRET_KEY</code>, plus the
          Supabase variables in <code className="rounded bg-muted px-1.5 py-0.5">.env.example</code>
          .
        </li>
      </ul>
    </div>
  );
}
