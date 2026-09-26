// A local stand-in for a push service (FCM, Apple, Mozilla, WNS), for the push tests (D-011, PSH-01…08).
// The relay (ENV_NAME=test, PUSH_TEST_TARGET) sends every push here, with the real endpoint in the query string.
// For each request it records the headers, VERIFIES the VAPID JWT (RFC 8292: ES256, audience = the endpoint's
// origin, subject, expiry) and DECRYPTS the payload (RFC 8291 aes128gcm) with the subscription's own keys, which
// only the subscriber holds. Tests script the responses (201, 404, 413, 429 with Retry-After, 5xx…).
import { createECDH, createHmac, createDecipheriv, createPublicKey, randomBytes, verify } from "node:crypto";
import { createServer, type Server } from "node:http";

export interface TestSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** The subscriber's private ECDH key (only the browser would have it). */
  ecdh: ReturnType<typeof createECDH>;
  authSecret: Buffer;
}

export interface CapturedPush {
  endpoint: string;
  ttl: number;
  urgency: string | undefined;
  topic: string | undefined;
  contentEncoding: string | undefined;
  jwt: { aud: string; sub: string; exp: number; valid: boolean; vapidPublicKey: string };
  /** The decrypted payload, or null if it couldn't be decrypted with this subscription's keys. */
  payload: string | null;
  bytes: number;
  at: number;
}

let counter = 0;

/** A subscription as a browser would create it, at an allowlisted push service host. */
export function newSubscription(host = "fcm.googleapis.com"): TestSubscription {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    endpoint: `https://${host}/fcm/send/test-${Date.now()}-${counter++}`,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: authSecret.toString("base64url"),
    ecdh,
    authSecret,
  };
}

const hkdfExtract = (salt: Buffer, ikm: Buffer) => createHmac("sha256", salt).update(ikm).digest();
const hkdfExpand = (prk: Buffer, info: Buffer, len: number) =>
  createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, len);

/** RFC 8291 §3.4 / RFC 8188: decrypts one aes128gcm record with the subscriber's keys. */
export function decrypt(sub: TestSubscription, body: Buffer): string | null {
  try {
    const salt = body.subarray(0, 16);
    const idlen = body[20]!;
    const asPublic = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen);
    const ecdhSecret = sub.ecdh.computeSecret(asPublic);
    const uaPublic = sub.ecdh.getPublicKey();
    const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
    const ikm = hkdfExpand(hkdfExtract(sub.authSecret, ecdhSecret), keyInfo, 32);
    const prk = hkdfExtract(salt, ikm);
    const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
    const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
    const d = createDecipheriv("aes-128-gcm", cek, nonce);
    d.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plain = Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - 16)), d.final()]);
    // The last record ends with the 0x02 delimiter, then optional zero padding.
    let end = plain.length - 1;
    while (end >= 0 && plain[end] === 0) end--;
    if (plain[end] !== 2) return null;
    return plain.subarray(0, end).toString("utf8");
  } catch {
    return null;
  }
}

/** RFC 8292: `Authorization: vapid t=<JWT>, k=<public key>`; the JWT is ES256 over header.claims. */
function checkVapid(header: string | undefined, endpoint: string): CapturedPush["jwt"] {
  const bad = { aud: "", sub: "", exp: 0, valid: false, vapidPublicKey: "" };
  const m = header?.match(/^vapid t=([^,]+),\s*k=(.+)$/);
  if (!m) return bad;
  const [token, key] = [m[1]!, m[2]!.trim()];
  const [h, c, s] = token.split(".");
  if (!h || !c || !s) return bad;
  const claims = JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as { aud: string; sub: string; exp: number };
  const raw = Buffer.from(key, "base64url");
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: raw.subarray(1, 33).toString("base64url"),
    y: raw.subarray(33, 65).toString("base64url"),
  };
  const ok = verify(
    "sha256",
    Buffer.from(`${h}.${c}`),
    { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(s, "base64url"),
  );
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const valid =
    ok &&
    claims.aud === origin &&
    claims.exp > now &&
    claims.exp <= now + 24 * 3600 &&
    /^mailto:|^https:/.test(claims.sub);
  return { ...claims, valid, vapidPublicKey: key };
}

export interface MockPush {
  url: string;
  pushes: CapturedPush[];
  /** Scripted responses for an endpoint, used in order; afterwards 201. */
  respond(endpoint: string, ...r: Array<{ status: number; retryAfter?: number; delayMs?: number }>): void;
  register(sub: TestSubscription): void;
  waitFor(pred: (p: CapturedPush) => boolean, timeoutMs?: number): Promise<CapturedPush>;
  close(): Promise<void>;
}

/** `port` 0 picks a free one; the Playwright journeys use a fixed port that the relay is configured with. */
export async function startMockPush(port = 0): Promise<MockPush> {
  const subs = new Map<string, TestSubscription>();
  const scripts = new Map<string, Array<{ status: number; retryAfter?: number; delayMs?: number }>>();
  const pushes: CapturedPush[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const endpoint = new URL(req.url ?? "/", "http://mock").searchParams.get("endpoint") ?? "";
      const body = Buffer.concat(chunks);
      const sub = subs.get(endpoint);
      pushes.push({
        endpoint,
        ttl: Number(req.headers.ttl),
        urgency: req.headers.urgency as string | undefined,
        topic: req.headers.topic as string | undefined,
        contentEncoding: req.headers["content-encoding"] as string | undefined,
        jwt: checkVapid(req.headers.authorization, endpoint),
        payload: sub ? decrypt(sub, body) : null,
        bytes: body.length,
        at: Date.now(),
      });
      const next = scripts.get(endpoint)?.shift() ?? { status: 201 };
      const send = () => {
        if (next.retryAfter !== undefined) res.setHeader("retry-after", String(next.retryAfter));
        res.writeHead(next.status).end();
      };
      if (next.delayMs) setTimeout(send, next.delayMs);
      else send();
    });
  });
  await new Promise<void>((r, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", r);
  });
  const addr = server.address();
  const bound = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${bound}`,
    pushes,
    respond(endpoint, ...r) {
      scripts.set(endpoint, [...(scripts.get(endpoint) ?? []), ...r]);
    },
    register(sub) {
      subs.set(sub.endpoint, sub);
    },
    async waitFor(pred, timeoutMs = 5000) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        const hit = pushes.find(pred);
        if (hit) return hit;
        if (Date.now() > end) throw new Error("no matching push arrived");
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
