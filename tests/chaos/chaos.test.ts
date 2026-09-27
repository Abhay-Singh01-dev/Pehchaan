// CHAOS-01 … CHAOS-05 (spec 21.5, 23): failures injected into the production stack on this machine while checks are
// in progress. Every check runs end to end with a real WebAuthn-format answer and the real 7-check verifier on the
// asker's side (tests/ops/lib/realcheck.ts), so "safe" is measured where it matters: the verdict a person would see.
// Each scenario must end in the correct verdict or in "Not confirmed yet" (NO_RESPONSE), never in a false green.
//
// The stack is the ops stack (real infra/vm files, images built from this checkout, deploy.sh) with ENV_NAME=test,
// which only allows PUSH_TEST_TARGET: the relays send every push to a stand-in push service on this machine that
// verifies VAPID and decrypts the payload (apps/relay/test/helpers/mock-push.ts) and can be told to fail.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Endpoint } from "@pehchaan/canary/client";
import { Session } from "@pehchaan/loadgen/session";
import { newSubscription, startMockPush, type MockPush } from "../../apps/relay/test/helpers/mock-push";
import { buildImages } from "../ops/lib/images";
import { phone, realCheck, relogged, type Phone } from "../ops/lib/realcheck";
import { docker, sleep } from "../ops/lib/sh";
import {
  ageKeyPair,
  caddyRoot,
  compose,
  containerOf,
  deploy,
  destroyStack,
  ORIGIN,
  RELAY_URL,
  SERVICES,
  stackEnv,
  TAG_A,
  waitHealthy,
  writeStack,
} from "../ops/lib/stack";

let ep: Endpoint;
let mock: MockPush;

/** Lets the relay containers reach the stand-in push service on this machine (Linux needs the explicit mapping). */
const OVERRIDE = `# Chaos tests only (tests/chaos): the relays reach the stand-in push service on the test machine.
services:
  relay-a: { extra_hosts: ["host.docker.internal:host-gateway"] }
  relay-b: { extra_hosts: ["host.docker.internal:host-gateway"] }
`;

const stopAll = (...phones: Phone[]) => phones.forEach((p) => p.session.stop());

beforeAll(async () => {
  mock = await startMockPush(0); // on 127.0.0.1; containers reach it through host.docker.internal
  const port = new URL(mock.url).port;
  await buildImages();
  const age = await ageKeyPair();
  await destroyStack().catch(() => {});
  const env = await stackEnv(age.recipient);
  writeStack(
    { ...env, ENV_NAME: "test", PUSH_TEST_TARGET: `http://host.docker.internal:${port}` },
    { "compose.override.yml": OVERRIDE },
  );
  await deploy(TAG_A);
  await waitHealthy(SERVICES, 120_000);
  ep = { url: RELAY_URL, origin: ORIGIN, relayHost: "localhost", ca: await caddyRoot() };
});

afterAll(async () => {
  await destroyStack();
  await mock?.close();
});

describe("CHAOS-01 · a relay container killed, and the whole VM rebooted, mid-check", () => {
  it("docker kill of the asker's container: the check completes on the other one (VERIFIED)", async () => {
    const asker = await phone(ep, "relay-a");
    const answerer = await phone(ep, "relay-b");
    try {
      const outcome = await realCheck({
        asker,
        answerer,
        decision: "ME",
        beforeAnswer: async () => {
          await docker(["kill", await containerOf("relay-a")]);
        },
      });
      expect(outcome).toMatchObject({ verdict: "VERIFIED", request: "accepted" });
      expect(asker.session.gateway).toMatch(/^relay-b-/);
    } finally {
      stopAll(asker, answerer);
      await compose(["start", "relay-a"]);
      await waitHealthy(["relay-a"], 90_000);
    }
  });

  it("reboot: the check in flight ends 'Not confirmed yet' (never green), and new checks work afterwards", async () => {
    const asker = await phone(ep);
    const answerer = await phone(ep);
    try {
      // The reboot happens while the answerer is looking at the prompt. Valkey keeps nothing on disk, so the request
      // record is gone when everything is back: the late answer can't be matched to anything (23: "Redis restarted").
      const outcome = await realCheck({
        asker,
        answerer,
        decision: "ME",
        beforeAnswer: async () => {
          await compose(["restart"]);
          await waitHealthy(SERVICES, 60_000);
        },
      });
      expect(outcome.request).toBe("accepted");
      expect(outcome.verdict).toBe("NO_RESPONSE");
    } finally {
      stopAll(asker, answerer);
    }
    const [a, b] = [await phone(ep), await phone(ep)];
    try {
      expect(await realCheck({ asker: a, answerer: b, decision: "ME" })).toMatchObject({ verdict: "VERIFIED" });
    } finally {
      stopAll(a, b);
    }
  });
});

describe("CHAOS-02 · Valkey restarted mid-check", () => {
  it("the check in flight ends 'Not confirmed yet'; routes heal and the next check on the same sockets passes", async () => {
    const asker = await phone(ep);
    const answerer = await phone(ep);
    try {
      const outcome = await realCheck({
        asker,
        answerer,
        decision: "ME",
        ttlMs: 15_000,
        beforeAnswer: async () => {
          await compose(["restart", "valkey"]);
          await waitHealthy(["valkey", "relay-a", "relay-b"], 60_000);
        },
      });
      expect(outcome).toMatchObject({ verdict: "NO_RESPONSE", request: "accepted" });
      // 15.4: no phone had to do anything; the relays re-register their sockets' routes.
      expect(await realCheck({ asker, answerer, decision: "NOT_ME" })).toMatchObject({ verdict: "DENIED" });
      expect(await realCheck({ asker, answerer, decision: "ME" })).toMatchObject({ verdict: "VERIFIED" });
    } finally {
      stopAll(asker, answerer);
    }
  });
});

describe("CHAOS-03 · Postgres down for 2 minutes", () => {
  it("a family that checked before keeps working; a brand-new contact fails safely, then works once it is back", async () => {
    const [a, b, c, d] = [await phone(ep), await phone(ep), await phone(ep), await phone(ep)];
    try {
      // a → b are an existing family: the first check creates their binding (which clears the Valkey binding cache
      // so the new sender appears), the second one warms the cache again. c → d have never checked.
      for (const decision of ["ME", "NOT_ME"] as const) {
        expect(await realCheck({ asker: a, answerer: b, decision })).toMatchObject({ request: "accepted" });
      }
      const downAt = Date.now();
      await compose(["stop", "postgres"]);
      try {
        expect(await realCheck({ asker: a, answerer: b, decision: "ME" })).toMatchObject({ verdict: "VERIFIED" });
        const fresh = await realCheck({ asker: c, answerer: d, decision: "ME", ttlMs: 10_000 });
        expect(fresh.verdict).toBe("NO_RESPONSE"); // the relay can't record a new binding: it fails closed
        expect(fresh.request).not.toBe("accepted");
        await sleep(Math.max(0, 120_000 - (Date.now() - downAt)));
      } finally {
        await compose(["start", "postgres"]);
        await waitHealthy(["postgres"], 60_000);
      }
      expect(await realCheck({ asker: c, answerer: d, decision: "ME" })).toMatchObject({ verdict: "VERIFIED" });
      expect(await realCheck({ asker: a, answerer: b, decision: "NOT_ME" })).toMatchObject({ verdict: "DENIED" });
    } finally {
      stopAll(a, b, c, d);
    }
  });
});

describe("CHAOS-04 · the push service returns 5xx", () => {
  it("a closed app's check ends 'Not confirmed yet' with a failed push; when push recovers, the tap-in answer passes", async () => {
    const asker = await phone(ep);
    const answerer = await phone(ep);
    const sub = newSubscription();
    mock.register(sub);
    try {
      const rc = await answerer.session.send("push.subscribe", {
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        vapidKeyId: "ops1",
      });
      expect(rc.state).toBe("accepted");
      answerer.session.stop(); // the app is closed: only push can reach it

      // The push service fails every attempt.
      mock.respond(sub.endpoint, ...Array.from({ length: 10 }, () => ({ status: 503 })));
      const failed = await realCheck({ asker, answerer, decision: "ME", noAnswer: true, ttlMs: 10_000 });
      expect(failed).toMatchObject({ verdict: "NO_RESPONSE", request: "accepted" });
      expect(failed.receipts).toContain("failed");

      // The push service is back (201). The notification arrives, the person taps it, the app logs in and answers.
      mock.clear(sub.endpoint);
      const reopened: Phone = { session: new Session(answerer.session.device, ep), cred: answerer.cred };
      const since = Date.now();
      const ok = await realCheck({
        asker,
        answerer: reopened,
        decision: "ME",
        afterAccepted: async () => {
          const push = await mock.waitFor((p) => p.endpoint === sub.endpoint && p.at >= since && p.jwt.valid, 15_000);
          expect(push.payload).not.toBeNull(); // encrypted to the subscription, and it decrypts
          await reopened.session.start();
        },
      });
      expect(ok).toMatchObject({ verdict: "VERIFIED", request: "accepted" });
      expect(ok.receipts).toContain("pushed");
      reopened.session.stop();
    } finally {
      stopAll(asker, answerer);
    }
  });
});

describe("CHAOS-05 · a phone offline for 5 s mid-check (airplane mode)", () => {
  it("the answerer drops right after the request arrives: it comes back and its answer passes", async () => {
    const asker = await phone(ep);
    const answerer = await phone(ep);
    try {
      const outcome = await realCheck({
        asker,
        answerer,
        decision: "ME",
        beforeAnswer: async () => answerer.session.goOffline(5000), // the answer waits in the phone's outbox
      });
      expect(outcome).toMatchObject({ verdict: "VERIFIED", request: "accepted" });
      await relogged(answerer, "relay-");
      expect(answerer.session.logins).toBe(2);
    } finally {
      stopAll(asker, answerer);
    }
  });

  it("the asker drops while it waits: the answer waits in its inbox and passes when it is back", async () => {
    const asker = await phone(ep);
    const answerer = await phone(ep);
    try {
      const outcome = await realCheck({
        asker,
        answerer,
        decision: "ME",
        beforeAnswer: async () => asker.session.goOffline(5000),
      });
      expect(outcome).toMatchObject({ verdict: "VERIFIED", request: "accepted" });
      await relogged(asker, "relay-");
      expect(asker.session.logins).toBe(2);
    } finally {
      stopAll(asker, answerer);
    }
  });
});
