"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";
import type { ActionResult } from "@/lib/actions/types";
import { signInLocal } from "@/server/actions/auth";

/** Local demo mode sign-in: any email, no password. Only rendered when local mode is active. */
export function LocalSignInForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(signInLocal, null);
  const error = state && !state.ok ? state.error : null;

  return (
    <div className="w-full max-w-sm rounded-3xl bg-card p-8 shadow-lift">
      <p className="inline-flex rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
        Local demo mode
      </p>
      <h1 className="mt-3 text-3xl font-semibold">Welcome to Pinched</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        No account needed here. Enter any email to start — your data stays on this machine. Use the
        same email next time to get back to it.
      </p>
      <form action={action} className="mt-6 space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={error?.fields?.email ? true : undefined}
            aria-describedby={error ? "sign-in-error" : undefined}
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">
            Name <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="name" name="name" autoComplete="name" placeholder="Sam" />
        </div>
        {error && (
          <p id="sign-in-error" role="alert" className="text-sm font-medium text-destructive">
            {error.message}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Starting…" : "Start planning"}
        </Button>
      </form>
    </div>
  );
}
