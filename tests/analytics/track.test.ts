import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLIENT_EVENTS, clientEventSchema, cleanProps, optedOut } from "@/lib/analytics/events";

const saved = { ...process.env };
const fetchMock = vi.fn(async () => new Response("{}"));

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.POSTHOG_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
  delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
});
afterEach(() => {
  process.env = { ...saved };
  vi.doUnmock("next/headers");
  vi.unstubAllGlobals();
});

async function loadTrack() {
  return (await import("@/server/analytics")).track;
}

describe("track", () => {
  it("does nothing at all unless a PostHog key is configured", async () => {
    const track = await loadTrack();
    await track("user_1", "signed_up", {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an anonymous, cookie-free event to the capture API", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    const track = await loadTrack();
    await track("user_1", "grocery_generated", { created: true, meals: 4, items_to_buy: 18 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/capture/");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "grocery_generated",
      distinct_id: "user_1",
      properties: {
        created: true,
        meals: 4,
        items_to_buy: 18,
        $lib: "pinched-server",
        $process_person_profile: false,
      },
    });
    expect(Object.keys(body).sort()).toEqual([
      "api_key",
      "distinct_id",
      "event",
      "properties",
      "timestamp",
    ]);
    // nothing that identifies the person beyond the opaque id
    expect(JSON.stringify(body)).not.toMatch(/@|email|name/i);
  });

  it("uses a custom host (EU cloud or self-hosted), without a trailing slash", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com/";
    const track = await loadTrack();
    await track("u", "pwa_opened", { platform: "ios" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://eu.i.posthog.com/capture/",
    );
  });

  it("drops anything that isn't a short, plain value", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    const track = await loadTrack();
    await track("u", "recipe_imported", {
      host: "x".repeat(500),
      // a stray object or function must never be serialised
      nested: { email: "a@b.c" },
      fn: () => 1,
      nan: Number.NaN,
    } as never);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const { properties } = JSON.parse(init.body as string);
    expect(properties.host).toHaveLength(100);
    expect(properties).not.toHaveProperty("nested");
    expect(properties).not.toHaveProperty("fn");
    expect(properties).not.toHaveProperty("nan");
  });

  it("never throws or blocks when PostHog is down", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const track = await loadTrack();
    await expect(track("u", "signed_up", {})).resolves.toBeUndefined();
  });

  it("skips people who send Global Privacy Control or Do Not Track", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers({ "sec-gpc": "1" }),
    }));
    const track = await loadTrack();
    await track("u", "signed_up", {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tracks people whose request carries no opt-out signal", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    vi.doMock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "x" }) }));
    const track = await loadTrack();
    await track("u", "signed_up", {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores events with no user", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    const track = await loadTrack();
    await track("", "signed_up", {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("opt-out signals", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("honours GPC and DNT, and nothing else", () => {
    expect(optedOut(h({ "sec-gpc": "1" }))).toBe(true);
    expect(optedOut(h({ dnt: "1" }))).toBe(true);
    expect(optedOut(h({ "sec-gpc": "0", dnt: "0" }))).toBe(false);
    expect(optedOut(h({}))).toBe(false);
  });
});

describe("cleanProps", () => {
  it("keeps strings, finite numbers and booleans", () => {
    expect(
      cleanProps({ a: "x", b: 2, c: false, d: null, e: undefined, f: [1], g: Infinity }),
    ).toEqual({
      a: "x",
      b: 2,
      c: false,
    });
  });
});

describe("client-reported events", () => {
  it("accepts only the install-funnel events, with known platforms", () => {
    expect(
      clientEventSchema.safeParse({ event: "install_prompt_shown", platform: "ios" }).success,
    ).toBe(true);
    expect(clientEventSchema.safeParse({ event: "install_accepted" }).success).toBe(true);
    expect(clientEventSchema.safeParse({ event: "pwa_opened", platform: "other" }).success).toBe(
      true,
    );
    expect(
      clientEventSchema.safeParse({ event: "install_prompt_shown", platform: "tv" }).success,
    ).toBe(false);
    expect(clientEventSchema.safeParse({ event: "pwa_opened" }).success).toBe(false);
  });

  it("refuses to let the browser report server events (it could inflate the funnel)", () => {
    for (const event of [
      "signed_up",
      "subscription_started",
      "grocery_generated",
      "checkout_started",
      "meal_added",
    ]) {
      expect(clientEventSchema.safeParse({ event }).success, event).toBe(false);
    }
    // and the allowlist and the schema agree
    for (const event of CLIENT_EVENTS) {
      expect(clientEventSchema.safeParse({ event, platform: "ios" }).success, event).toBe(true);
    }
  });
});
