// CRY-11: the sender signature on plain envelopes (9.5).
import { beforeAll, describe, expect, it } from "vitest";
import type { Header } from "../src/e2e";
import { signPlain, verifyPlain } from "../src/plain-sig";
import { makeDevice, type TestDevice } from "./helpers";

let maa: TestDevice;
let arjun: TestDevice;
let mallory: TestDevice;
let h: Header;
let plain: { spk: string; alert: { id: string; aboutLabel: string; amountInr: number } };

beforeAll(async () => {
  [maa, arjun, mallory] = await Promise.all([makeDevice(), makeDevice(), makeDevice()]);
  h = { kind: "alert", id: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F", from: maa.deviceId, to: arjun.deviceId };
  plain = { spk: maa.dk, alert: { id: "a1", aboutLabel: "Arjun", amountInr: 50000 } };
});

describe("CRY-11 · psig", () => {
  it("a valid signature verifies (with and without the saved card)", async () => {
    const psig = await signPlain(plain, h, maa.sign.privateKey);
    expect(await verifyPlain(plain, h, psig)).toBe(true);
    expect(await verifyPlain(plain, h, psig, maa.dk)).toBe(true);
  });

  it("a changed payload is rejected", async () => {
    const psig = await signPlain(plain, h, maa.sign.privateKey);
    const changed: typeof plain = { ...plain, alert: { ...plain.alert, amountInr: 1 } };
    expect(await verifyPlain(changed, h, psig)).toBe(false);
  });

  it("a changed header is rejected", async () => {
    const psig = await signPlain(plain, h, maa.sign.privateKey);
    expect(await verifyPlain(plain, { ...h, to: mallory.deviceId }, psig)).toBe(false);
    expect(await verifyPlain(plain, { ...h, kind: "guard.prompt" }, psig)).toBe(false);
  });

  it("a sender key that isn't the envelope sender's, or not my saved card's, is rejected", async () => {
    const forged = { ...plain, spk: mallory.dk };
    const psig = await signPlain(forged, h, mallory.sign.privateKey);
    expect(await verifyPlain(forged, h, psig)).toBe(false); // spk ↔ from mismatch
    const psigMaa = await signPlain(plain, h, maa.sign.privateKey);
    expect(await verifyPlain(plain, h, psigMaa, mallory.dk)).toBe(false);
  });

  it("key order in the payload doesn't matter (canonical)", async () => {
    const psig = await signPlain(plain, h, maa.sign.privateKey);
    const reordered = { alert: { amountInr: 50000, aboutLabel: "Arjun", id: "a1" }, spk: maa.dk };
    expect(await verifyPlain(reordered, h, psig)).toBe(true);
  });

  it("garbage is rejected without throwing", async () => {
    expect(await verifyPlain({ spk: "!!" }, h, "x")).toBe(false);
  });
});
