import Link from "next/link";

import { Logo } from "@/components/brand/logo";

import { AccountMenu } from "./account-menu";
import { DesktopNav, MobileNav } from "./nav";

type Props = {
  mode: "clerk" | "local";
  name: string | null;
  email: string | null;
  /** Slot for the offline/sync indicator. */
  status?: React.ReactNode;
  children: React.ReactNode;
};

/** Sticky header, pill nav on desktop, bottom tab bar on phones. */
export function AppShell({ mode, name, email, status, children }: Props) {
  return (
    <div className="min-h-dvh pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-card px-4 py-2 text-sm font-semibold shadow-lift focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <header className="app-header sticky top-0 z-30 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Link href="/plan" aria-label="Pinched — plan">
            <Logo />
          </Link>
          <DesktopNav />
          <div className="ml-auto flex items-center gap-3">
            {status}
            <AccountMenu mode={mode} name={name} email={email} />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 md:py-10">
        {children}
      </main>
      <MobileNav />
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-primary-strong">
            {eyebrow}
          </p>
        )}
        <h1 className="text-4xl font-semibold md:text-5xl">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
