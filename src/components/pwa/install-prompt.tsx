"use client";

import { PlusSquare, Share } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trackClientEvent } from "@/server/actions/analytics";
import {
  afterDismiss,
  afterInstall,
  isIosDevice,
  parseInstallState,
  shouldAskToInstall,
  type InstallState,
} from "@/lib/install/schedule";

// ─────────────────────────────── shared install state ───────────────────────────────

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const STORAGE_KEY = "pinched.install.v1";
const OFFER_EVENT = "pinched:offer-install";
const OPENED_KEY = "pinched.opened.v1";

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const SERVER_SNAPSHOT = { canPrompt: false, installed: false };
let snapshot = SERVER_SNAPSHOT;

function publish() {
  const next = { canPrompt: deferred !== null, installed };
  if (next.canPrompt !== snapshot.canPrompt || next.installed !== snapshot.installed) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
}

function readState(): InstallState {
  try {
    return parseInstallState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseInstallState(null);
  }
}
function writeState(state: InstallState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — the prompt just may show again
  }
}

const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const ios = () => isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

function useInstallStore() {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
}

/** Ask (politely, once in a while) — call after the first grocery list or prep plan. */
export function offerInstall() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OFFER_EVENT));
}

/** The install affordance for Settings: what this device can do, and a way to do it. */
export function useInstall() {
  const store = useInstallStore();
  const [isStandalone, setStandalone] = useState(false);
  const [isIos, setIos] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      setStandalone(standalone());
      setIos(ios());
    }, 0);
    return () => clearTimeout(id);
  }, []);
  return {
    installed: store.installed || isStandalone,
    canPrompt: store.canPrompt,
    ios: isIos,
    async prompt() {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      publish();
      return outcome === "accepted";
    },
  };
}

// ─────────────────────────────── the sheet ───────────────────────────────

function InstallSteps() {
  return (
    <ol className="space-y-4 text-sm">
      <li className="flex items-center gap-3 rounded-2xl bg-secondary p-3">
        <span className="grid size-9 shrink-0 place-content-center rounded-full bg-card font-semibold">
          1
        </span>
        <span className="flex-1">
          Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
        </span>
        <Share className="size-6 text-primary-strong" aria-hidden />
      </li>
      <li className="flex items-center gap-3 rounded-2xl bg-secondary p-3">
        <span className="grid size-9 shrink-0 place-content-center rounded-full bg-card font-semibold">
          2
        </span>
        <span className="flex-1">
          Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
        </span>
        <PlusSquare className="size-6 text-primary-strong" aria-hidden />
      </li>
    </ol>
  );
}

export function InstallGuide({ className }: { className?: string }) {
  return (
    <div className={className}>
      <InstallSteps />
    </div>
  );
}

/** Mounted once in the app shell. Listens for the browser's install event and for "offer" requests. */
export function InstallPrompt() {
  const [open, setOpen] = useState(false);
  const [onIos, setOnIos] = useState(false);
  const store = useInstallStore();

  useEffect(() => {
    const onBefore = (event: Event) => {
      event.preventDefault();
      deferred = event as BeforeInstallPromptEvent;
      publish();
    };
    const onInstalled = () => {
      deferred = null;
      installed = true;
      writeState(afterInstall(readState()));
      setOpen(false);
      publish();
      void trackClientEvent({ event: "install_accepted" });
    };
    const onOffer = () => {
      const iosDevice = ios();
      if (!deferred && !iosDevice) return; // nothing this browser can do
      if (!shouldAskToInstall(readState(), { standalone: standalone(), now: Date.now() })) return;
      setOnIos(iosDevice && !deferred);
      setOpen(true);
      void trackClientEvent({
        event: "install_prompt_shown",
        platform: iosDevice && !deferred ? "ios" : "other",
      });
    };
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener(OFFER_EVENT, onOffer);

    // Launched as an installed app (Home Screen / app window)? Say so once per session — this is the
    // PRD's "PWA install rate", and the only way to see an iOS install (Safari gives no event).
    try {
      if (standalone() && !window.sessionStorage.getItem(OPENED_KEY)) {
        window.sessionStorage.setItem(OPENED_KEY, "1");
        void trackClientEvent({ event: "pwa_opened", platform: ios() ? "ios" : "other" });
      }
    } catch {
      // storage unavailable: skip
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener(OFFER_EVENT, onOffer);
    };
  }, []);

  function dismiss() {
    writeState(afterDismiss(readState(), Date.now()));
    setOpen(false);
    void trackClientEvent({ event: "install_dismissed" });
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    publish();
    if (outcome === "accepted") setOpen(false);
    else dismiss();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {onIos ? "Add Pinched to your Home Screen" : "Install Pinched"}
          </DialogTitle>
          <DialogDescription>
            Get a reminder when it&apos;s time to prep, and open your week in one tap — even without
            signal.
          </DialogDescription>
        </DialogHeader>
        {onIos ? (
          <>
            <InstallSteps />
            <p className="text-xs text-muted-foreground">
              On iPhone and iPad, reminders and durable offline storage only work from the Home
              Screen.
            </p>
          </>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
          {!onIos && (
            <Button onClick={() => void install()} disabled={!store.canPrompt}>
              Install
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
