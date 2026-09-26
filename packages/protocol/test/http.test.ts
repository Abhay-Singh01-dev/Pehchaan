// The signed HTTP routes' bodies and the wake push (spec 11.2, 11.4): strict, like every inbound message.
import { describe, expect, it } from "vitest";
import { SIGNED_REQUEST_WINDOW_MS, inboxFetchBody, pushResubscribeBody, ulid, wakePush } from "../src/index";

const DEVICE = "AbCdEfGhIjKlMnOpQrStUv";
const SIG = "a".repeat(86);
const sub = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  p256dh: "B".repeat(87),
  auth: "c".repeat(22),
  vapidKeyId: "v1",
};

describe("signed HTTP bodies (11.2, 11.4)", () => {
  it("accepts a well-formed inbox fetch, and nothing extra", () => {
    const ok = { deviceId: DEVICE, msgId: ulid(), ts: Date.now(), sig: SIG };
    expect(inboxFetchBody.safeParse(ok).success).toBe(true);
    expect(inboxFetchBody.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(inboxFetchBody.safeParse({ ...ok, msgId: "not-a-ulid" }).success).toBe(false);
    expect(inboxFetchBody.safeParse({ ...ok, sig: "short" }).success).toBe(false);
    expect(inboxFetchBody.safeParse({ ...ok, ts: -1 }).success).toBe(false);
  });

  it("accepts a resubscription with an optional old endpoint, and checks the subscription strictly", () => {
    const ok = { deviceId: DEVICE, subscription: sub, ts: Date.now(), sig: SIG };
    expect(pushResubscribeBody.safeParse(ok).success).toBe(true);
    expect(
      pushResubscribeBody.safeParse({ ...ok, oldEndpoint: "https://fcm.googleapis.com/fcm/send/old" }).success,
    ).toBe(true);
    expect(pushResubscribeBody.safeParse({ ...ok, subscription: { ...sub, auth: "x" } }).success).toBe(false);
    expect(pushResubscribeBody.safeParse({ ...ok, subscription: { ...sub, extra: 1 } }).success).toBe(false);
  });

  it("allows ±120 s between a signed request and the relay's clock", () => {
    expect(SIGNED_REQUEST_WINDOW_MS).toBe(120_000);
  });
});

describe("wake push (11.4)", () => {
  it("names the message to fetch and nothing more", () => {
    const ok = { t: "wake", id: ulid(), kind: "verify.request", from: DEVICE };
    expect(wakePush.safeParse(ok).success).toBe(true);
    expect(wakePush.safeParse({ ...ok, body: {} }).success).toBe(false);
    expect(wakePush.safeParse({ ...ok, t: "deliver" }).success).toBe(false);
  });
});
