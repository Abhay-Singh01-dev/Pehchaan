// C-12a · Presence is asked on demand, at most every 30 s per screen, only while visible (backend spec 12).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIMING } from "@pehchaan/protocol";
import { startPresencePoller, type PresencePoller } from "@/app/presence";
import type { PresenceState } from "@/services/types";

let poller: PresencePoller | undefined;
let visible = true;
const query = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "push" as PresenceState])));
const onStates = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  visible = true;
  query.mockClear();
  onStates.mockClear();
});

afterEach(() => {
  poller?.stop();
  vi.useRealTimers();
});

const start = () => (poller = startPresencePoller({ ids: ["a", "b"], query, onStates, isVisible: () => visible }));

describe("presence (12)", () => {
  it("asks once when the screen opens, and hands over the answer", async () => {
    start();
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(["a", "b"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onStates).toHaveBeenCalledWith({ a: "push", b: "push" });
  });

  it("re-asks about every 30 s while visible, never more often", async () => {
    start();
    await vi.advanceTimersByTimeAsync(TIMING.PRESENCE_REASK_MS - 1);
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TIMING.PRESENCE_REASK_MS / 3 + 1);
    expect(query).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(query.mock.calls.length).toBeLessThanOrEqual(2 + (5 * 60_000) / TIMING.PRESENCE_REASK_MS);
  });

  it("coming back into view asks at once only if 30 s have passed", async () => {
    start();
    poller!.poke();
    expect(query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TIMING.PRESENCE_REASK_MS);
    poller!.poke();
    expect(query.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("asks nothing while the screen is hidden", async () => {
    visible = false;
    start();
    await vi.advanceTimersByTimeAsync(3 * TIMING.PRESENCE_REASK_MS);
    expect(query).not.toHaveBeenCalled();
  });

  it("stops when the screen closes, and a late answer is dropped", async () => {
    let resolve: (s: Record<string, PresenceState>) => void = () => {};
    query.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    start();
    poller!.stop();
    resolve({ a: "online", b: "online" });
    await vi.advanceTimersByTimeAsync(3 * TIMING.PRESENCE_REASK_MS);
    expect(onStates).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
  });

  it("a failed query means 'not known' (null), not 'reachable'", async () => {
    query.mockRejectedValueOnce(new Error("offline"));
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStates).toHaveBeenCalledWith(null);
  });
});
