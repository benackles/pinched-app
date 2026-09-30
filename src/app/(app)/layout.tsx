import { AppShell } from "@/components/app-shell/app-shell";
import { TimezoneSync } from "@/components/app-shell/timezone-sync";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { OfflineSync } from "@/components/pwa/offline-sync";
import { authMode } from "@/lib/auth/config";
import { requireSession } from "@/server/auth";
import { getProfile } from "@/server/profile";

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
      {children}
    </AppShell>
  );
}
