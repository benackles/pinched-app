"use client";

/** Web Push on this device: permission, subscribe, unsubscribe. The server stores the endpoint and keys. */

export type PushStatus =
  | { state: "unsupported"; reason: string }
  | { state: "needs-install" } // iOS only delivers push to an installed Home Screen app
  | { state: "blocked" }
  | { state: "off" }
  | { state: "on"; endpoint: string };

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

async function registration() {
  return navigator.serviceWorker?.getRegistration("/");
}

export async function getPushStatus(): Promise<PushStatus> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return isIos() && !isStandalone()
      ? { state: "needs-install" }
      : { state: "unsupported", reason: "This browser can't receive push notifications." };
  }
  if (isIos() && !isStandalone()) return { state: "needs-install" };
  if (Notification.permission === "denied") return { state: "blocked" };
  const reg = await registration();
  if (!reg) {
    return {
      state: "unsupported",
      reason: "Reminders work once Pinched is installed from its production site.",
    };
  }
  const subscription = await reg.pushManager.getSubscription();
  return subscription ? { state: "on", endpoint: subscription.endpoint } : { state: "off" };
}

/** VAPID public keys are URL-safe base64; the Push API wants bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type SubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string;
};

/** Asks for permission and subscribes this device. Must be called from a tap. */
export async function subscribeThisDevice(vapidPublicKey: string): Promise<SubscriptionPayload> {
  const reg = await registration();
  if (!reg) throw new Error("Reminders need the installed app.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were not allowed.");
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));
  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent.slice(0, 300),
  };
}

/** Unsubscribes this device and returns its endpoint so the server can forget it. */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
