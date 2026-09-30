import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LocalSignInForm } from "@/components/auth/local-sign-in-form";
import { SetupNeeded } from "@/components/auth/setup-needed";
import { authMode } from "@/lib/auth/config";
import { getSession } from "@/server/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getSession()) redirect("/plan");
  const mode = authMode();
  if (mode === "clerk") return <SignIn fallbackRedirectUrl="/plan" signUpUrl="/sign-up" />;
  if (mode === "local") return <LocalSignInForm />;
  return <SetupNeeded />;
}
