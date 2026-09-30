import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearQueue,
  enqueue,
  flushQueue,
  listQueue,
  pendingValues,
  queueSize,
  resetQueueForTests,
  type QueueEntry,
  type ReplayOutcome,
} from "./queue";

beforeEach(async () => {
  resetQueueForTests();
  await clearQueue();
});

const ALICE = "user_alice";
const BOB = "user_bob";

describe("offline check-off queue", () => {
  it("stores changes per person, oldest first", async () => {
    await enqueue(ALICE, { kind: "grocery.check", targetId: "a", value: true }, 100);
    await enqueue(ALICE, { kind: "prep.complete", targetId: "t", value: true }, 200);
    await enqueue(BOB, { kind: "grocery.check", targetId: "b", value: true }, 150);
    expect((await listQueue(ALICE)).map((e) => e.targetId)).toEqual(["a", "t"]);
    expect(await queueSize(BOB)).toBe(1);
  });

  it("keeps only the latest toggle of an item (last write wins)", async () => {
    await enqueue(ALICE, { kind: "grocery.check", targetId: "a", value: true }, 100);
    await enqueue(ALICE, { kind: "grocery.check", targetId: "a", value: false }, 200);
    await enqueue(ALICE, { kind: "grocery.check", targetId: "a", value: true }, 300);
    const entries = await listQueue(ALICE);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ value: true, at: 300 });
  });

  it("does not collapse a grocery item and a prep task that share an id", async () => {
    await enqueue(ALICE, { kind: "grocery.check", targetId: "same", value: true });
    await enqueue(ALICE, { kind: "prep.complete", targetId: "same", value: true });
    expect(await queueSize(ALICE)).toBe(2);
  });

  it("exposes the latest pending value per item for the UI overlay", async () => {
    await enqueue(ALICE, { kind: "grocery.check", targetId: "a", value: true });
    await enqueue(ALICE, { kind: "grocery.check", targetId: "b", value: false });
    await enqueue(ALICE, { kind: "prep.complete", targetId: "t", value: true });
    const entries = await listQueue(ALICE);
    expect(pendingValues(entries, "grocery.check")).toEqual(
      new Map([
        ["a", true],
        ["b", false],
      ]),
    );
    expect(pendingValues(entries, "prep.complete")).toEqual(new Map([["t", true]]));
  });

  it("replays in order, removes what succeeded, and stops at the first connection failure", async () => {
    await enqueue(ALICE, { kind: "grocery.check", targetId: "1", value: true }, 1);
    await enqueue(ALICE, { kind: "grocery.check", targetId: "2", value: true }, 2);
    await enqueue(ALICE, { kind: "grocery.check", targetId: "3", value: true }, 3);
    const seen: string[] = [];
    const result = await flushQueue(ALICE, async (entry: QueueEntry): Promise<ReplayOutcome> => {
      seen.push(entry.targetId);
      return entry.targetId === "2" ? "retry" : "done";
    });
    expect(seen).toEqual(["1", "2"]);
    expect(result).toMatchObject({ done: 1, dropped: 0, remaining: 2 });
    expect((await listQueue(ALICE)).map((e) => e.targetId)).toEqual(["2", "3"]);
  });

  it("drops changes the server can never accept, and keeps going", async () => {
    await enqueue(ALICE, { kind: "grocery.check", targetId: "gone", value: true }, 1);
    await enqueue(ALICE, { kind: "grocery.check", targetId: "ok", value: true }, 2);
    const result = await flushQueue(ALICE, async (entry) =>
      entry.targetId === "gone" ? "drop" : "done",
    );
    expect(result).toMatchObject({ done: 1, dropped: 1, remaining: 0 });
  });

  it("never replays one person's changes under another's session", async () => {
    await enqueue(ALICE, { kind: "grocery.check", targetId: "a", value: true });
    const seen: string[] = [];
    await flushQueue(BOB, async (entry) => {
      seen.push(entry.userId);
      return "done";
    });
    expect(seen).toEqual([]);
    expect(await queueSize(ALICE)).toBe(1);
  });

  it("does not run two flushes at once", async () => {
    await enqueue(ALICE, { kind: "grocery.check", targetId: "a", value: true });
    let calls = 0;
    const slow = async (): Promise<ReplayOutcome> => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "done";
    };
    const [first, second] = await Promise.all([flushQueue(ALICE, slow), flushQueue(ALICE, slow)]);
    expect(calls).toBe(1);
    expect(first).toBe(second);
  });

  it("can be cleared for one person or everyone", async () => {
    await enqueue(ALICE, { kind: "grocery.check", targetId: "a", value: true });
    await enqueue(BOB, { kind: "grocery.check", targetId: "b", value: true });
    await clearQueue(ALICE);
    expect(await queueSize(ALICE)).toBe(0);
    expect(await queueSize(BOB)).toBe(1);
    await clearQueue();
    expect(await queueSize(BOB)).toBe(0);
  });
});
