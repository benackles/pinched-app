import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearQueue, enqueue, resetQueueForTests } from "./queue";
import { queueSnapshot, resetQueueStoreForTests, subscribeToQueue } from "./queue-store";

const ALICE = "user_alice";
const BOB = "user_bob";

beforeEach(async () => {
  resetQueueStoreForTests();
  resetQueueForTests();
  await clearQueue();
});

describe("queue store (what the UI reads)", () => {
  it("announces the very first change a person makes — the queue was empty before", async () => {
    // This is the offline check-off: tap, and the box must show checked at once. A watcher on an
    // empty queue has to hear about the first entry, not only about later ones.
    const heard = vi.fn();
    const stop = subscribeToQueue(ALICE, heard);
    await new Promise((resolve) => setTimeout(resolve, 20)); // the initial read settles

    await enqueue(ALICE, { kind: "grocery.check", targetId: "onion", value: true });
    await vi.waitFor(() => expect(queueSnapshot(ALICE)).toHaveLength(1));
    expect(heard).toHaveBeenCalled();
    expect(queueSnapshot(ALICE)[0]).toMatchObject({ targetId: "onion", value: true });
    stop();
  });

  it("follows later changes: a second item, a flip back, and a cleared queue", async () => {
    const stop = subscribeToQueue(ALICE, () => {});
    await enqueue(ALICE, { kind: "grocery.check", targetId: "a", value: true });
    await enqueue(ALICE, { kind: "grocery.check", targetId: "b", value: true });
    await vi.waitFor(() => expect(queueSnapshot(ALICE)).toHaveLength(2));

    await enqueue(ALICE, { kind: "grocery.check", targetId: "a", value: false });
    await vi.waitFor(() =>
      expect(queueSnapshot(ALICE).find((e) => e.targetId === "a")?.value).toBe(false),
    );
    expect(queueSnapshot(ALICE)).toHaveLength(2); // last write wins, no duplicate

    await clearQueue(ALICE);
    await vi.waitFor(() => expect(queueSnapshot(ALICE)).toHaveLength(0));
    stop();
  });

  it("keeps people apart, and only wakes the person whose queue changed", async () => {
    const alice = vi.fn();
    const bob = vi.fn();
    const stopA = subscribeToQueue(ALICE, alice);
    const stopB = subscribeToQueue(BOB, bob);
    await new Promise((resolve) => setTimeout(resolve, 20));
    alice.mockClear();
    bob.mockClear();

    await enqueue(BOB, { kind: "prep.complete", targetId: "t", value: true });
    await vi.waitFor(() => expect(queueSnapshot(BOB)).toHaveLength(1));
    expect(bob).toHaveBeenCalled();
    expect(alice).not.toHaveBeenCalled();
    expect(queueSnapshot(ALICE)).toHaveLength(0);
    stopA();
    stopB();
  });

  it("notifies every listener of the same person (a list and the header both watch)", async () => {
    const one = vi.fn();
    const two = vi.fn();
    const stopOne = subscribeToQueue(ALICE, one);
    const stopTwo = subscribeToQueue(ALICE, two);
    await enqueue(ALICE, { kind: "grocery.check", targetId: "x", value: true });
    await vi.waitFor(() => expect(one).toHaveBeenCalled());
    expect(two).toHaveBeenCalled();

    stopOne();
    one.mockClear();
    two.mockClear();
    await enqueue(ALICE, { kind: "grocery.check", targetId: "y", value: true });
    await vi.waitFor(() => expect(two).toHaveBeenCalled());
    expect(one).not.toHaveBeenCalled(); // unsubscribed
    stopTwo();
  });

  it("returns a stable empty list when there is nothing queued", () => {
    expect(queueSnapshot(ALICE)).toBe(queueSnapshot(ALICE));
    expect(queueSnapshot(ALICE)).toEqual([]);
  });
});
