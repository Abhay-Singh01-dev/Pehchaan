// Phase 8 (J-16): the relay-side frame capture used to prove that no personal data crosses the relay. A TEST relay
// (FRAME_CAPTURE_FILE, allowed only with ENV_NAME=test) writes every WebSocket frame it receives and sends, one
// JSON line each; the privacy journey (tests/e2e/privacy.spec.ts) then scans them.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { TestDevice } from "./helpers/client";
import { setupRelays, type Env } from "./helpers/relays";

const file = join(mkdtempSync(join(tmpdir(), "pehchaan-capture-")), "frames.jsonl");
let env: Env;
beforeAll(async () => {
  env = await setupRelays("capture", { env: { FRAME_CAPTURE_FILE: file } });
});
afterAll(() => env.cleanup());

const lines = () =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { at: number; dir: "in" | "out"; text: string });

describe("frame capture (test relays only)", () => {
  it("records every frame in and out, as sent on the wire", async () => {
    const [maa, arjun] = [await TestDevice.create(), await TestDevice.create()];
    const m = await maa.login(env.relays[0]!);
    await arjun.login(env.relays[0]!);
    const r = await maa.plainSend("alert", arjun, { grant: arjun.cardGrant });
    m.send("send", r.body, r.id);
    await m.receipt(r.id, "accepted");
    const got = lines();
    const types = (dir: "in" | "out") =>
      got.filter((l) => l.dir === dir).map((l) => (JSON.parse(l.text) as { t: string }).t);
    expect(types("out")).toEqual(expect.arrayContaining(["hello", "auth.ok", "receipt", "deliver"]));
    expect(types("in")).toEqual(expect.arrayContaining(["auth", "grant.set", "send"]));
    expect(got.find((l) => l.dir === "in" && l.text.includes(r.id))!.text).toBe(
      JSON.stringify(JSON.parse(got.find((l) => l.dir === "in" && l.text.includes(r.id))!.text)),
    );
    expect(got.every((l) => typeof l.at === "number")).toBe(true);
  });

  it("is refused by the configuration outside the test environment", () => {
    expect(() =>
      loadConfig({
        ...env.env,
        ENV_NAME: "staging",
        FRAME_CAPTURE_FILE: file,
        VAPID_PUBLIC_KEY: "x",
        VAPID_PRIVATE_KEY: "y",
      }),
    ).toThrow(/FRAME_CAPTURE_FILE/);
  });
});
