// The Security Lab module (spec 14), created only when LAB_ENABLED=true. A Lab page (a laptop: its own device)
// plays an attacker who fully controls the relay, against test phones that opted in, and watches every attack
// fail on the asker's phone.
//
// The five safety layers (14.1), each enforced here:
//   1. The runtime switch cfg:lab (`admin lab on|off`, at most 12 h). While it is off, every lab.* is refused
//      (lab_disabled, core/authz.ts) and nothing is intercepted.
//   2. The Lab password: only an Argon2id hash is configured; 5 attempts per 10 min per IP, shared by lab.join
//      and lab.optin. A Lab page session lasts 4 h.
//   3. Per-device opt-in (lab.optin, with the password), 4 h.
//   4. A message is seen or changed ONLY when both its sender and its recipient are opted in.
//   5. Every Lab action is written to audit_events; opted-in phones show the banner.
//
// The Lab never decides a verdict. The asker's phone runs the normal verifier on whatever arrives, and its
// lab.report is sent AFTER the verdict, only so the Lab page can show it (the honesty rule, 14.3).
import { argon2Verify } from "hash-wasm";
import {
  TIMING,
  relayFrame,
  ulid,
  type ClientFrame,
  type DeliverBody,
  type RelayBody,
  type RelayType,
} from "@pehchaan/protocol";
import type { Hub } from "../hub";
import { mayInject, mayReport } from "../core/authz";
import type { StoredFrame } from "../core/inbox";
import { refuse } from "../core/refusal";
import type { Connection } from "../ws/connection";
import { labAttacks } from "../store/schema";
import type { LabModule } from "./lab";

type LabFrame = Extract<ClientFrame, { t: `lab.${string}` }>;
type Attack = RelayBody<"lab.held">["attack"];
type TrafficEvent = RelayBody<"lab.traffic">["event"];

/** A held envelope, kept in Valkey so that whichever gateway gets the release (or the timeout) acts once. */
interface Held {
  stored: StoredFrame;
  to: string;
  attack: Attack;
}

/** A request the Lab tampered with, until the asker's phone reports what it showed. */
interface Tampered {
  attack: Attack;
  asker: string;
  answerer: string;
}

/** Bus messages on the lab channel: every gateway re-sends lab.state to ITS opted-in phones and Lab pages. */
type LabBusMessage = { t: "switch"; on: boolean } | { t: "state"; notice?: string };

/** The loosely typed stored body, read as the deliver body it is. */
const bodyOf = (s: StoredFrame) => s.frame.body as DeliverBody;

const ARMED_TTL_MS = 15 * 60_000;
const TAMPERED_TTL_MS = 10 * 60_000;

const TRAFFIC_KIND: Record<string, TrafficEvent["kind"] | undefined> = {
  "verify.request": "request",
  "verify.answer": "answer",
  alert: "alert",
  "guard.prompt": "guard",
};

export function createLabModule(hub: Hub): LabModule {
  const { redis: r, keys: k } = hub;
  const timers = new Map<string, NodeJS.Timeout>();

  // ─── State ────────────────────────────────────────────────────────────────

  const isOn = async () => (await r.get(k.labSwitch())) === "on";
  const isOptedIn = async (deviceId: string) => (await r.exists(k.labOptin(deviceId))) === 1;
  const isLabPage = async (deviceId: string) => (await r.exists(k.labSession(deviceId))) === 1;

  /** Members of a sorted set scored by expiry, after dropping the expired ones. */
  async function live(key: string): Promise<string[]> {
    await r.zremrangebyscore(key, 0, Date.now());
    return r.zrange(key, 0, -1);
  }

  async function state(notice?: string): Promise<RelayBody<"lab.state">> {
    const active = await isOn();
    const [optedIn, armed, since]: [string[], Record<string, string>, string | null] = active
      ? await Promise.all([live(k.labOptins()), r.hgetall(k.labArmed()), r.get(k.labSince())])
      : [[], {}, null];
    return {
      active,
      // While the Lab is off, nobody counts as opted in: phones go back to sealing everything.
      optedIn,
      armed:
        armed.attack && armed.asker && armed.answerer
          ? { attack: armed.attack as Attack, asker: armed.asker, answerer: armed.answerer }
          : null,
      since: Number(since) || Date.now(),
      ...(notice ? { notice } : {}),
    };
  }

  /** Sends lab.state to this gateway's sockets that belong to an opted-in phone or a Lab page. */
  async function sendStateLocally(notice?: string): Promise<void> {
    const [s, phones, pages] = await Promise.all([state(notice), live(k.labOptins()), live(k.labPages())]);
    const audience = new Set([...phones, ...pages]);
    for (const conn of hub.sessions.sockets()) {
      if (conn.deviceId && audience.has(conn.deviceId)) conn.send("lab.state", s);
    }
  }

  /** Every gateway re-sends lab.state to its own sockets (the bus reaches this gateway too). */
  const broadcastState = (notice?: string) =>
    hub.bus.publish(k.labChannel(), { t: "state", ...(notice ? { notice } : {}) } satisfies LabBusMessage);

  /** A frame to every Lab page, wherever it is connected (live only: never stored, never pushed). */
  async function toPages<T extends RelayType>(t: T, body: RelayBody<T>): Promise<void> {
    const frame = relayFrame(t, ulid(), body);
    for (const page of await live(k.labPages())) await hub.router.notify(page, frame);
  }

  /** lab.traffic for an envelope between two opted-in devices. The payload is the readable `plain` both phones
   *  chose to send (9.5); a sealed one stays sealed. The Lab page writes the readable summary. */
  async function traffic(stored: StoredFrame, to: string, extra: Partial<TrafficEvent> = {}): Promise<void> {
    const b = bodyOf(stored);
    const kind = TRAFFIC_KIND[b.kind];
    if (!kind) return;
    await toPages("lab.traffic", {
      event: {
        id: stored.frame.id,
        at: Date.now(),
        kind,
        from: b.from,
        to,
        summary: b.plain ? kind : `${kind} · sealed`,
        ...(b.plain ? { payload: b.plain } : {}),
        ...(b.re ? { requestId: b.re } : {}),
        ...extra,
      },
    });
  }

  // ─── Checks ───────────────────────────────────────────────────────────────

  /** Layer 2: every attempt counts against the IP's limit (shared by lab.join and lab.optin), right or wrong. */
  async function checkPassword(conn: Connection, password: string): Promise<void> {
    await hub.limiter.take("lab_password_ip", hub.limiter.ipKey(conn.ip));
    const hash = hub.config.LAB_PASSWORD_HASH;
    const ok = hash ? await argon2Verify({ password, hash }).catch(() => false) : false;
    if (!ok) refuse("lab_denied");
  }

  /** Arming, releasing and injecting are for a Lab page with a live session. */
  async function requirePage(conn: Connection): Promise<string> {
    const me = conn.deviceId!;
    if (!(await isLabPage(me))) refuse("lab_denied");
    return me;
  }

  const accepted = (conn: Connection, f: LabFrame) => conn.send("receipt", { of: f.id, state: "accepted" });

  // ─── Holding ──────────────────────────────────────────────────────────────

  /** The Lab page didn't answer in time (14.3): the original goes on unchanged, and it isn't an attack. */
  async function releaseOriginal(heldId: string): Promise<void> {
    timers.delete(heldId);
    const raw = await r.getdel(k.labHeld(heldId));
    if (!raw) return; // already released or answered by an injection
    const h = JSON.parse(raw) as Held;
    hub.log.info({ attack: h.attack }, "lab: hold timed out, original forwarded");
    const re = bodyOf(h.stored).re;
    if (re) await r.del(k.labTampered(re));
    await hub.router.route(h.to, h.stored, { inbox: true, push: true });
    await traffic(h.stored, h.to);
    await hub.audit.record("lab_attack", null, { attack: h.attack, outcome: "held_timeout" });
    await broadcastState("held_timeout");
  }

  async function intercept(stored: StoredFrame, to: string): Promise<boolean> {
    if (!(await isOn())) return false;
    const from = stored.frame.body.from;
    // Layer 4: anyone else's traffic is never seen, let alone changed.
    if (!(await isOptedIn(from)) || !(await isOptedIn(to))) return false;
    const kind = stored.frame.body.kind;
    const match = kind === "verify.request" ? "request" : kind === "verify.answer" ? "answer" : null;
    // The armed attack fires once: the script takes it and disarms in one step (two gateways can't both fire).
    const attack = match ? ((await r.labTakeArmed(k.labArmed(), match, from, to)) as Attack | null) : null;
    // Operational trace of the Lab (never a payload; devices pseudonymous, 16.7).
    hub.log.info({ kind, attack, from: hub.hmac(from), to: hub.hmac(to) }, attack ? "lab: held" : "lab: passed");
    if (!attack) {
      await traffic(stored, to);
      return false;
    }
    const heldId = stored.frame.id;
    const requestId = bodyOf(stored).re!;
    const tampered: Tampered =
      match === "request" ? { attack, asker: from, answerer: to } : { attack, asker: to, answerer: from };
    await r.set(k.labHeld(heldId), JSON.stringify({ stored, to, attack } satisfies Held), "PX", TAMPERED_TTL_MS);
    await r.set(k.labTampered(requestId), JSON.stringify(tampered), "PX", TAMPERED_TTL_MS);
    timers.set(
      heldId,
      setTimeout(() => void releaseOriginal(heldId).catch(() => {}), hub.config.LAB_HOLD_MS),
    );
    await traffic(stored, "relay", { tampered: attack, summary: `${match} · held by the attacker` });
    await toPages("lab.held", {
      heldId,
      attack,
      frame: { ...stored.frame, body: { ...bodyOf(stored), ttlMs: Math.max(0, stored.expiresAt - Date.now()) } },
    });
    await hub.audit.record("lab_attack", from, { attack, outcome: "held" });
    await broadcastState();
    return true;
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  async function handle(conn: Connection, f: LabFrame): Promise<void> {
    const me = conn.deviceId!;
    const now = Date.now();
    switch (f.t) {
      case "lab.join": {
        await checkPassword(conn, f.body.password);
        await r.set(k.labSession(me), "1", "PX", TIMING.LAB_SESSION_MS);
        await r.zadd(k.labPages(), now + TIMING.LAB_SESSION_MS, me);
        await r.set(k.labSince(), String(now), "PX", TIMING.LAB_SWITCH_MS, "NX");
        conn.labSessionId = me;
        await hub.audit.record("lab_session", me, { action: "join" });
        accepted(conn, f);
        conn.send("lab.state", await state());
        return;
      }
      case "lab.optin": {
        await checkPassword(conn, f.body.password);
        await r.set(k.labOptin(me), "1", "PX", TIMING.LAB_OPTIN_MS);
        await r.zadd(k.labOptins(), now + TIMING.LAB_OPTIN_MS, me);
        await hub.audit.record("lab_optin", me, { action: "on" });
        accepted(conn, f);
        await broadcastState();
        return;
      }
      case "lab.optout": {
        await r.del(k.labOptin(me));
        await r.zrem(k.labOptins(), me);
        await hub.audit.record("lab_optin", me, { action: "off" });
        accepted(conn, f);
        // It no longer gets broadcasts: tell it directly that it is out.
        conn.send("lab.state", await state());
        await broadcastState();
        return;
      }
      case "lab.arm": {
        await requirePage(conn);
        const { attack, asker, answerer } = f.body;
        // Only between two opted-in phones (layer 4); otherwise it could never fire anyway.
        if (asker === answerer || !(await isOptedIn(asker)) || !(await isOptedIn(answerer))) refuse("not_allowed");
        await r.multi().hset(k.labArmed(), { attack, asker, answerer }).pexpire(k.labArmed(), ARMED_TTL_MS).exec();
        hub.log.info({ attack, asker: hub.hmac(asker), answerer: hub.hmac(answerer) }, "lab: armed");
        await hub.audit.record("lab_attack", me, { attack, outcome: "armed" });
        accepted(conn, f);
        await broadcastState();
        return;
      }
      case "lab.disarm": {
        await requirePage(conn);
        await r.del(k.labArmed());
        accepted(conn, f);
        await broadcastState();
        return;
      }
      case "lab.release": {
        await requirePage(conn);
        const raw = await r.getdel(k.labHeld(f.body.heldId));
        if (!raw) refuse("expired");
        clearTimeout(timers.get(f.body.heldId));
        timers.delete(f.body.heldId);
        const h = JSON.parse(raw!) as Held;
        // The attacker's change: the readable payload is replaced; the signature (and psig) are NOT recomputed,
        // because an attacker can't. The asker's phone finds out (14.3).
        const stored: StoredFrame = f.body.replacement
          ? { ...h.stored, frame: { ...h.stored.frame, body: { ...h.stored.frame.body, plain: f.body.replacement } } }
          : h.stored;
        const heldRe = bodyOf(h.stored).re;
        if (!f.body.replacement && heldRe) await r.del(k.labTampered(heldRe));
        await hub.router.route(h.to, stored, { inbox: true, push: true });
        await traffic(stored, h.to, f.body.replacement ? { tampered: h.attack } : {});
        await hub.audit.record("lab_attack", me, { attack: h.attack, outcome: "released" });
        accepted(conn, f);
        return;
      }
      case "lab.inject": {
        await requirePage(conn);
        const { as, to, kind, re, plain } = f.body;
        // Only answers can be injected, and only as the target of a real, open request (8.6): the injected
        // answer goes through the same request-record script as a genuine one (16.3 row 11).
        if (kind !== "verify.answer") refuse("bad_request");
        const a = await mayInject(hub, as, to, re, now);
        // The held request (replay/forge) is answered: it is never forwarded now.
        const heldRaw = await r.getdel(k.labHeld(re));
        clearTimeout(timers.get(re));
        timers.delete(re);
        const attack = heldRaw ? (JSON.parse(heldRaw) as Held).attack : undefined;
        const expiresAt = a.deadline + TIMING.ANSWER_GRACE_MS;
        const stored: StoredFrame = {
          frame: {
            v: 1,
            t: "deliver",
            id: ulid(now),
            sts: now,
            body: { from: as, kind, re, ttlMs: expiresAt - now, ...(a.late ? { late: true } : {}), plain },
          },
          expiresAt,
        };
        await hub.router.route(to, stored, { inbox: true, push: true });
        await traffic(stored, to, { from: "relay", ...(attack ? { tampered: attack } : {}) });
        await hub.audit.record("lab_attack", me, { ...(attack ? { attack } : {}), outcome: "injected" });
        accepted(conn, f);
        return;
      }
      case "lab.report": {
        // A phone's report of the verdict it ALREADY showed (14.3): from an opted-in asker, about its own request.
        if (!(await isOptedIn(me))) refuse("not_allowed");
        await mayReport(hub, me, f.body.requestId);
        const { requestId, verdict, invalidReason, failedChecks } = f.body;
        accepted(conn, f);
        await toPages("lab.traffic", {
          event: {
            id: `verdict-${requestId}`,
            at: now,
            kind: "answer",
            from: me,
            to: me,
            summary: `verdict · ${verdict}`,
            requestId,
            verdictSeen: verdict,
          },
        });
        const raw = await r.getdel(k.labTampered(requestId));
        if (!raw) return; // not an attack: a genuine check between opted-in phones
        const t = JSON.parse(raw) as Tampered;
        // A false green: the asker's phone showed VERIFIED for something the Lab changed. Must always be 0.
        const falseGreen = verdict === "VERIFIED";
        await hub.store.db.insert(labAttacks).values({
          attack: t.attack,
          asker: t.asker,
          answerer: t.answerer,
          verdict,
          invalidReason: invalidReason ?? null,
          failedChecks,
          falseGreen,
        });
        hub.metrics.labAttacks.inc({ attack: t.attack, verdict });
        if (falseGreen) {
          hub.metrics.labFalseGreens.inc();
          hub.log.error({ attack: t.attack }, "SECURITY LAB FALSE GREEN: a tampered check was shown as VERIFIED");
        }
        await hub.audit.record("lab_attack", t.asker, { attack: t.attack, verdict, falseGreen });
        await toPages("lab.result", {
          attack: t.attack,
          requestId,
          verdict,
          ...(invalidReason ? { invalidReason } : {}),
          failedChecks,
          falseGreen,
        });
        return;
      }
    }
  }

  return {
    isOn,
    isOptedIn,
    async optInState(deviceId) {
      const ttl = await r.pttl(k.labOptin(deviceId));
      return ttl > 0 ? { optedIn: true, until: Date.now() + ttl } : { optedIn: false };
    },
    intercept,
    handle,
    async onLogin(conn) {
      const me = conn.deviceId!;
      const [page, optedIn] = await Promise.all([isLabPage(me), isOptedIn(me)]);
      if (page) conn.labSessionId = me;
      if (page || optedIn) conn.send("lab.state", await state());
    },
    onClose() {
      /* sessions and opt-ins outlive a socket; they expire on their own (4 h) */
    },
    async start() {
      await hub.bus.subscribe(k.labChannel(), (msg) => {
        const m = msg as LabBusMessage;
        void sendStateLocally(m.t === "state" ? m.notice : undefined).catch(() => {});
      });
    },
    async stop() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
