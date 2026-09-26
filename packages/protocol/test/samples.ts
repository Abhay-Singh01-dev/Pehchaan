// One valid sample of every message and payload (PRO-01).
import { ulid } from "../src/ulid";

const b64 = (bytes: number, fill = 7) => Buffer.from(new Uint8Array(bytes).fill(fill)).toString("base64url");
const key = () => {
  const k = new Uint8Array(65).fill(9);
  k[0] = 4;
  return Buffer.from(k).toString("base64url");
};

export const ID = {
  maa: "Mx9Qe2Lr7Tb4Nw1Kc6Vh0S",
  arjun: "Ar3Jn8Pk2Wq5Ez7Uy1Gd4F",
  msg: "01JB7Y8Q3Z6N4V5W2K9C0D1E2F",
  req: "01JB7Y8Q3Z6N4V5W2K9C0D1E2G",
};
export const KEY = key();
export const NONCE = b64(32);
export const SIG = b64(64);

export const payloads = {
  "verify.request": {
    spk: KEY,
    sek: KEY,
    fromName: "Sunita",
    req: {
      v: 1,
      requestId: ID.req,
      nonce: NONCE,
      fromDeviceId: ID.maa,
      toDeviceId: ID.arjun,
      claimedLabel: "बेटा",
      reason: "money",
      amountInr: 50000,
      createdAt: 1761900000000,
      expiresAt: 1761900060000,
    },
  },
  "verify.answer": {
    spk: KEY,
    ans: {
      requestId: ID.req,
      nonce: NONCE,
      decision: "NOT_ME",
      keyType: "pk",
      credId: b64(16),
      authenticatorData: b64(37),
      clientDataJSON: b64(120),
      signature: b64(71),
      answeredAt: 1761900009800,
    },
  },
  alert: {
    spk: KEY,
    sek: KEY,
    alert: {
      id: "alert_1",
      type: "impersonation",
      aboutDeviceId: ID.arjun,
      aboutLabel: "Arjun",
      victimName: "Sunita",
      victimPhone: "+91 98765 43210",
      amountInr: 50000,
      createdAt: 1761900010000,
    },
  },
  "guard.prompt": {
    spk: KEY,
    prompt: {
      claimedLabel: "Arjun",
      claimedDeviceId: ID.arjun,
      amountInr: 20000,
      tactics: ["identity", "money"],
      at: 1,
    },
  },
} as const;

export const sealedSample = { alg: "p256-hkdf-a256gcm", epk: KEY, iv: b64(12), ct: b64(400), sig: SIG };

export const clientBodies: Record<string, unknown> = {
  auth: { deviceId: ID.maa, devicePub: KEY, sig: SIG, client: { ver: "1.0.0+9c1e2ab", platform: "android-chrome" } },
  ping: {},
  send: {
    kind: "verify.request",
    to: ID.arjun,
    re: ID.req,
    grant: `${b64(8)}.${b64(16)}`,
    ttlMs: 60000,
    e2e: sealedSample,
  },
  ack: { of: ID.msg },
  seen: { re: ID.req },
  cancel: { re: ID.req },
  "presence.query": { ids: [ID.arjun] },
  "push.subscribe": {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    p256dh: KEY,
    auth: b64(16),
    vapidKeyId: "v1",
  },
  "push.unsubscribe": { endpoint: "https://fcm.googleapis.com/fcm/send/abc" },
  "push.test": {},
  "grant.set": { grantId: b64(8), hash: b64(32), rotate: false },
  "contact.list": {},
  "contact.revoke": { deviceId: ID.arjun },
  "contact.unrevoke": { deviceId: ID.arjun },
  "device.retire": {},
  "lab.join": { password: "correct horse" },
  "lab.optin": { password: "correct horse" },
  "lab.optout": {},
  "lab.arm": { attack: "change", asker: ID.maa, answerer: ID.arjun },
  "lab.disarm": {},
  "lab.release": { heldId: ID.msg, replacement: payloads["verify.answer"] },
  "lab.inject": { as: ID.arjun, to: ID.maa, kind: "verify.answer", re: ID.req, plain: payloads["verify.answer"] },
  "lab.report": { requestId: ID.req, verdict: "INVALID", invalidReason: "changed", failedChecks: [3] },
};

export const deliverSample = {
  from: ID.maa,
  kind: "verify.request",
  re: ID.req,
  ttlMs: 59000,
  e2e: sealedSample,
};

export const relayBodies: Record<string, unknown> = {
  hello: {
    serverNonce: NONCE,
    serverTime: 1,
    gatewayId: "relay-a-7f3c",
    minClient: "1.0.0",
    vapidKeyId: "v1",
    env: "production",
    e2eRequired: true,
  },
  "auth.ok": { serverTime: 1, pushStatus: "ok", lab: { optedIn: false } },
  pong: { serverTime: 1 },
  deliver: deliverSample,
  receipt: { of: ID.msg, re: ID.req, state: "accepted" },
  presence: { states: { [ID.arjun]: "push" } },
  "contact.list.result": { contacts: [{ deviceId: ID.maa, since: 1, via: "grant" }] },
  error: { code: "rate_limited", of: ID.msg, retryAfterMs: 1200 },
  reconnect: { afterMs: 1500 },
  "lab.state": { active: true, optedIn: [ID.maa, ID.arjun], armed: null, since: 1 },
  "lab.traffic": {
    event: { id: ID.msg, at: 1, kind: "answer", from: ID.arjun, to: ID.maa, summary: "answer · NOT ME", payload: {} },
  },
  "lab.held": {
    heldId: ID.msg,
    attack: "change",
    frame: { v: 1, t: "deliver", id: ID.msg, sts: 1, body: deliverSample },
  },
  "lab.result": {
    attack: "change",
    requestId: ID.req,
    verdict: "INVALID",
    invalidReason: "changed",
    failedChecks: [3],
    falseGreen: false,
  },
};

export const frame = (t: string, body: unknown) => JSON.stringify({ v: 1, t, id: ulid(), ts: 1761900000000, body });
