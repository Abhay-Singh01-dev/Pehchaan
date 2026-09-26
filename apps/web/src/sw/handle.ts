// The service worker's push, click and re-subscription handling (backend spec 11.2, 11.4, 11.5), written against
// injected dependencies so it can be tested without a browser. `src/sw.ts` wires it to the real events.
//
// A push carries a deliver frame (or a small "wake" pointing at one, or the "test" alert):
//   1. a wake is fetched from the relay with a request signed by this device's key;
//   2. the frame is stored in the push inbox, where the app processes it once, whichever way it arrived first;
//   3. the envelope is opened with this device's key (never trusted unopened) and named from MY family list;
//   4. a notification is ALWAYS shown (silent while the app is on screen), and open windows are told.
// If anything can't be opened or read, the notification is the generic "Open Pehchaan."
import { b64url } from "@pehchaan/crypto/bytes";
import { fetchMessage, resubscribeMessage, signAuth } from "@pehchaan/crypto/device-auth";
import { parseRelayFrame, wakePush, type DeliverBody } from "@pehchaan/protocol";
import type { IdentityRow, PehchaanDB } from "@/store/db";
import { unwrap } from "@/services/real/relay/envelope";
import { notificationOptions, plan, type NotifyLang, type PushContent } from "./describe";

export interface WindowLike {
  visibilityState: string;
  postMessage(m: unknown): void;
  focus?(): Promise<unknown>;
}

export interface SwDeps {
  db: PehchaanDB;
  relayHttp: string;
  relayHost: string;
  vapidPublicKey: string;
  vapidKeyId: string;
  showNotification(title: string, options: NotificationOptions): Promise<void>;
  windows(): Promise<WindowLike[]>;
  openWindow(url: string): Promise<unknown>;
  fetch: typeof fetch;
  now?: () => number;
}

type Deliver = { id: string; body: DeliverBody };

async function identity(db: PehchaanDB): Promise<IdentityRow | undefined> {
  return db.identity.get("me");
}

/** 11.4: the frame a wake points at, fetched with a request signed by this device's key. */
export async function fetchFromInbox(deps: SwDeps, msgId: string): Promise<unknown> {
  const me = await identity(deps.db);
  if (!me) return null;
  const ts = (deps.now ?? Date.now)();
  const sig = await signAuth(me.signKey.privateKey, fetchMessage(deps.relayHost, me.deviceId, msgId, ts));
  const res = await deps.fetch(`${deps.relayHttp}/v1/inbox/fetch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: me.deviceId, msgId, ts, sig }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { frame?: unknown }).frame ?? null;
}

async function labelOf(db: PehchaanDB, deviceId: string | undefined): Promise<string | undefined> {
  if (!deviceId) return undefined;
  return (await db.family.where("deviceId").equals(deviceId).first())?.label;
}

/** Opens the envelope and turns it into what the notification may say. Unreadable → "unreadable". */
export async function contentOf(db: PehchaanDB, f: Deliver): Promise<PushContent> {
  const me = await identity(db);
  if (!me) return { kind: "unreadable" };
  const b = f.body;
  const known = await db.family.where("deviceId").equals(b.from).first();
  // The service worker never accepts a readable (plain) envelope: only the open app, opted in to the Lab, may.
  const opts = { acceptPlain: false, knownSenderDk: known?.devicePub };
  switch (b.kind) {
    case "verify.request": {
      const o = await unwrap("verify.request", b, f.id, me, opts);
      // FC-27, as in the app: only a request addressed to this device, from the envelope's sender.
      if (!o.ok || o.payload.req.toDeviceId !== me.deviceId || o.payload.req.fromDeviceId !== b.from) {
        return { kind: "unreadable" };
      }
      return {
        kind: "verify.request",
        requestId: o.payload.req.requestId,
        fromName: o.payload.fromName,
        ...(known ? { askerLabel: known.label } : {}),
      };
    }
    case "verify.cancel":
      if (!b.re) return { kind: "unreadable" };
      return { kind: "verify.cancel", requestId: b.re, ...(known ? { askerLabel: known.label } : {}) };
    case "verify.answer": {
      const o = await unwrap("verify.answer", b, f.id, me, opts);
      if (!o.ok || !b.re) return { kind: "unreadable" };
      return { kind: "verify.answer", requestId: b.re, ...(known ? { label: known.label } : {}) };
    }
    case "alert": {
      const o = await unwrap("alert", b, f.id, me, opts);
      if (!o.ok) return { kind: "unreadable" };
      const a = o.payload.alert;
      return {
        kind: "alert",
        id: a.id,
        type: a.type,
        about: (await labelOf(db, a.aboutDeviceId)) ?? a.aboutLabel,
        victim: known?.label ?? a.victimName,
      };
    }
    case "guard.prompt": {
      const o = await unwrap("guard.prompt", b, f.id, me, opts);
      if (!o.ok) return { kind: "unreadable" };
      const p = o.payload.prompt;
      return { kind: "guard.prompt", at: p.at, claimed: (await labelOf(db, p.claimedDeviceId)) ?? p.claimedLabel };
    }
  }
}

async function language(db: PehchaanDB): Promise<NotifyLang> {
  const p = await db.profile.get("me");
  return p?.lang === "hi" ? "hi" : "en";
}

/** The push event (11.5). `data` is the decrypted push payload as text (or null). */
export async function handlePush(deps: SwDeps, data: string | null): Promise<void> {
  const now = (deps.now ?? Date.now)();
  let raw: unknown;
  try {
    raw = data ? JSON.parse(data) : null;
  } catch {
    raw = null;
  }
  let content: PushContent = { kind: "unreadable" };
  let test: { sts: number } | null = null;

  if (raw && typeof raw === "object" && (raw as { t?: unknown }).t === "test") {
    content = { kind: "test" };
    const sts = (raw as { sts?: unknown }).sts;
    test = { sts: typeof sts === "number" ? sts : 0 };
  } else {
    // A wake: fetch the frame it points at (11.4).
    const wake = wakePush.safeParse(raw);
    if (wake.success) raw = await fetchFromInbox(deps, wake.data.id).catch(() => null);
    const frame = raw ? parseRelayFrame(JSON.stringify(raw)) : null;
    if (frame?.t === "deliver") {
      // Kept for the app, which handles it exactly once (dedupe by id), whichever way it arrives (11.5).
      await deps.db.pushInbox.put({ id: frame.id, frame: raw, at: now });
      content = await contentOf(deps.db, frame).catch((): PushContent => ({ kind: "unreadable" }));
    }
  }

  const wins = await deps.windows();
  const visible = wins.some((w) => w.visibilityState === "visible");
  const p = plan(content, await language(deps.db));
  await deps.showNotification(p.title, notificationOptions(p, visible, now));
  for (const w of wins) {
    w.postMessage(test ? { type: "push-test", sts: test.sts, at: now } : { type: "push-frame" });
  }
}

/** A tap on the notification: focus the open app on the right screen, or open it there (11.5). */
export async function handleClick(deps: SwDeps, url: unknown): Promise<void> {
  // Only this app's own paths: a notification can never send the phone somewhere else.
  const path = typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/";
  const [w] = await deps.windows();
  if (w?.focus) {
    await w.focus();
    w.postMessage({ type: "navigate", url: path });
  } else {
    await deps.openWindow(path);
  }
}

/** `pushsubscriptionchange` (11.2, P1): register the new subscription with a request signed by this device. */
export async function handleSubscriptionChange(
  deps: SwDeps,
  subscription: { endpoint: string; getKey(name: "p256dh" | "auth"): ArrayBuffer | null },
  oldEndpoint?: string,
): Promise<boolean> {
  const me = await identity(deps.db);
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!me || !p256dh || !auth) return false;
  const ts = (deps.now ?? Date.now)();
  const sig = await signAuth(
    me.signKey.privateKey,
    resubscribeMessage(deps.relayHost, me.deviceId, subscription.endpoint, ts),
  );
  const res = await deps.fetch(`${deps.relayHttp}/v1/push/resubscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: me.deviceId,
      subscription: {
        endpoint: subscription.endpoint,
        p256dh: b64url(new Uint8Array(p256dh)),
        auth: b64url(new Uint8Array(auth)),
        vapidKeyId: deps.vapidKeyId,
      },
      ...(oldEndpoint && oldEndpoint !== subscription.endpoint ? { oldEndpoint } : {}),
      ts,
      sig,
    }),
  });
  return res.ok;
}
