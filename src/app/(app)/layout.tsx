import { AppShell } from "@/components/app-shell/app-shell";
import { TimezoneSync } from "@/components/app-shell/timezone-sync";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { OfflineSync } from "@/components/pwa/offline-sync";
import { PwaSession } from "@/components/pwa/pwa-register";
import { authMode } from "@/lib/auth/config";
import { requireSession } from "@/server/auth";
import { getProfile } from "@/server/profile";

// Every screen in here belongs to a signed-in person, so none is ever prerendered. Without this, a
// page that reads no `searchParams` (Settings, New recipe) is built statically — and a build that has
// no sign-in configured would bake the redirect to /sign-in into it for everyone.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const profile = await getProfile();
  const mode = authMode() === "clerk" ? "clerk" : "local";
  return (
    <AppShell
      mode={mode}
      name={profile.name}
      email={profile.email}
      status={<OfflineSync userId={session.userId} />}
    >
      <TimezoneSync profileZone={profile.timezone} />
      <InstallPrompt />
      <PwaSession userId={session.userId} />
      {children}
    </AppShell>
  );
}
