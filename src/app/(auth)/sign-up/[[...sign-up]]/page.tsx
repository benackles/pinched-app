import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LocalSignInForm } from "@/components/auth/local-sign-in-form";
import { SetupNeeded } from "@/components/auth/setup-needed";
import { authMode } from "@/lib/auth/config";
import { getSession } from "@/server/auth";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignUpPage() {
  if (await getSession()) redirect("/plan");
  const mode = authMode();
  if (mode === "clerk") return <SignUp fallbackRedirectUrl="/plan" signInUrl="/sign-in" />;
  if (mode === "local") return <LocalSignInForm />;
  return <SetupNeeded />;
}
