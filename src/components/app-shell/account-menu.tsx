"use client";

import { useClerk } from "@clerk/nextjs";
import { LogOut, Settings } from "lucide-react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { purgeUserCaches } from "@/lib/pwa/sw-client";
import { signOutLocal } from "@/server/actions/auth";

function Trigger({ initial }: { initial: string }) {
  return (
    <DropdownMenuTrigger
      className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-primary-strong text-sm font-semibold text-primary-foreground pointer-coarse:size-11"
      aria-label="Account menu"
    >
      {initial}
    </DropdownMenuTrigger>
  );
}

function Items({ label, signOut }: { label: string; signOut: React.ReactNode }) {
  return (
    <DropdownMenuContent align="end" className="min-w-52">
      <DropdownMenuLabel className="font-normal text-muted-foreground">{label}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/settings">
          <Settings className="size-4" aria-hidden /> Settings
        </Link>
      </DropdownMenuItem>
      {signOut}
    </DropdownMenuContent>
  );
}

function ClerkAccountMenu({ initial, label }: { initial: string; label: string }) {
  const clerk = useClerk();
  return (
    <DropdownMenu>
      <Trigger initial={initial} />
      <Items
        label={label}
        signOut={
          <DropdownMenuItem
            onSelect={async () => {
              // The worker's caches hold this person's week: clear them before the session ends.
              await purgeUserCaches();
              await clerk.signOut({ redirectUrl: "/" });
            }}
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </DropdownMenuItem>
        }
      />
    </DropdownMenu>
  );
}

function LocalAccountMenu({ initial, label }: { initial: string; label: string }) {
  return (
    <DropdownMenu>
      <Trigger initial={initial} />
      <Items
        label={label}
        signOut={
          <DropdownMenuItem
            onSelect={async (event) => {
              event.preventDefault();
              await purgeUserCaches();
              await signOutLocal();
            }}
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </DropdownMenuItem>
        }
      />
    </DropdownMenu>
  );
}

export function AccountMenu({
  mode,
  name,
  email,
}: {
  mode: "clerk" | "local";
  name: string | null;
  email: string | null;
}) {
  const label = email ?? name ?? "Signed in";
  const initial = (name ?? email ?? "?").trim().charAt(0).toUpperCase() || "?";
  return mode === "clerk" ? (
    <ClerkAccountMenu initial={initial} label={label} />
  ) : (
    <LocalAccountMenu initial={initial} label={label} />
  );
}
