// RealRelay (backend spec 7–9, 11.5, 12, 13, FC-6, FC-7, FC-27): the app's side of the relay protocol.
//
//   - sends through the outbox (same id until a receipt), and resolves sendRequest() on `accepted`
//     (or rejects after 5 s: D3 then shows "Couldn't reach the network")
//   - acks every delivery immediately after parsing it, before opening it
//   - drops duplicates (by message id and request id) and anything for a request it has already closed
//     (a 2-minute tombstone: a verify.cancel can arrive before its request, 8.10)
//   - drops a request that isn't addressed to this device or whose sender isn't the envelope's sender (FC-27)
//   - seals every payload end-to-end, except between two Security-Lab-opted-in devices (9.5, FC-7)
//   - after each login: re-registers the grant and the push subscription, then flushes the outbox (8.9)
//   - processes what the service worker received by push while the app was closed (11.5)
import {
  TIMING,
  ulid,
  type ClientBody,
  type ClientType,
  type DeliverBody,
  type RelayBody,
  type RelayFrame,
} from "@pehchaan/protocol";
import { APP_VERSION } from "@/app/flags";
import { appConfig, platformName } from "@/app/config";
import type { IdentityRow, PehchaanDB } from "@/store/db";
import { grantHash } from "../../identity";
import { RelayError } from "../../errors";
import type {
  CancelNotice,
  ConnectionState,
  Contact,
  FamilyAlert,
  FamilyMember,
  GuardPrompt,
  IncomingAnswer,
  IncomingRequest,
  PeerInfo,
  PresenceState,
  PushSubscriptionInfo,
  Receipt,
  RecipientCard,
  RelayInfo,
  RelayService,
  Unsubscribe,
  VerifyRequest,
  WireAnswer,
} from "../../types";
import { Outbox } from "./outbox";
import { RelaySocket } from "./socket";
import { alertPayload, answerPayload, promptPayload, requestPayload, unwrap, wrap } from "./envelope";

type Listener<T> = (v: T) => void;
type SendKind = "verify.request" | "verify.answer" | "alert" | "guard.prompt";
/** What the relay sends a Security Lab page (14.2). */
export type LabRelayFrame = Extract<RelayFrame, { t: `lab.${string}` }>;
/** What a Security Lab page sends the relay. */
export type LabCommand = "lab.join" | "lab.arm" | "lab.disarm" | "lab.release" | "lab.inject";

export interface RealRelayDeps {
  db: PehchaanDB;
  identity: () => Promise<IdentityRow>;
  /** My saved card for a device, if it's in my family list (its signing key must match, 9.2). */
  lookupMember: (deviceId: string) => Promise<FamilyMember | undefined>;
  /** Grant rotation lives with the identity. */
  rotateLocalGrant: () => Promise<IdentityRow>;
  url?: string;
  relayHost?: string;
  WebSocketImpl?: typeof WebSocket;
}

const ALERT_TTL_MS = TIMING.INBOX_TTL_ALERT_MS;
const PROMPT_TTL_MS = TIMING.INBOX_TTL_PROMPT_MS;
/** The relay decides an answer's lifetime from the request record; the app keeps retrying at most this long. */
const ANSWER_RETRY_MS = 90_000;

export class RealRelay implements RelayService {
  private socket: RelaySocket;
  private outbox: Outbox;
  private me: IdentityRow | null = null;
  private lastMsg: number | null = null;
  private relayInfo: RelayInfo = { e2e: true };
  private labOptedIn = false;
  private labPeers = new Set<string>();
  private pushSub: PushSubscriptionInfo | null = null;
  /** Message ids and request ids already handled, and requests this phone has closed (8.10). */
  private seenIds = new Map<string, number>();
  private tombstones = new Map<string, number>();
  private waiting = new Map<
    string,
    { resolve: (r: Receipt) => void; reject: (e: unknown) => void; timer?: ReturnType<typeof setTimeout> }
  >();
  private replies = new Map<string, Array<(f: RelayFrame) => void>>();
  private reachable = new Set<string>();
  /** Deliveries that arrived before anyone listened, per listener set (the login drain can beat React). */
  private pending = new Map<Set<Listener<never>>, unknown[]>();
  /** The login's own steps are done (8.9): queued messages may go out. False while disconnected. */
  private loginReady = false;

  private ls = {
    state: new Set<Listener<ConnectionState>>(),
    presence: new Set<Listener<string[]>>(),
    request: new Set<Listener<IncomingRequest>>(),
    answer: new Set<Listener<IncomingAnswer>>(),
    alert: new Set<Listener<FamilyAlert>>(),
    guard: new Set<Listener<GuardPrompt>>(),
    receipt: new Set<Listener<Receipt>>(),
    cancel: new Set<Listener<CancelNotice>>(),
    update: new Set<Listener<void>>(),
    info: new Set<Listener<RelayInfo>>(),
    lab: new Set<Listener<LabRelayFrame>>(),
  };

  constructor(private deps: RealRelayDeps) {
    this.socket = new RelaySocket({
      url: deps.url ?? appConfig.relayUrl,
      relayHost: deps.relayHost ?? appConfig.relayHost,
      identity: deps.identity,
      appVersion: APP_VERSION,
      platform: platformName(),
      onFrame: (f) => void this.onFrame(f),
      onLogin: (hello, ok) => void this.onLogin(hello, ok),
      onState: (s) => {
        if (s !== "connected") this.loginReady = false;
        this.ls.state.forEach((cb) => cb(s));
      },
      onUpdateRequired: () => this.ls.update.forEach((cb) => cb()),
      ...(deps.WebSocketImpl ? { WebSocketImpl: deps.WebSocketImpl } : {}),
    });
    this.outbox = new Outbox(
      // Nothing queued goes out until the login's own steps have (8.9): see onLogin.
      (frame) => this.loginReady && this.socket.send(frame),
      deps.db,
      (e) => {
        const w = this.waiting.get(e.id);
        if (w) {
          this.waiting.delete(e.id);
          w.reject(new RelayError("unreachable"));
        }
      },
    );
  }

  // ─── Connection ──────────────────────────────────────────────────────────

  connect(_deviceId: string): void {
    void this.deps.identity().then((me) => {
      this.me = me;
      void this.outbox.load().then(() => this.outbox.start());
      this.socket.start();
      this.listenToServiceWorker();
      void this.drainPushInbox();
    });
  }

  reconnect(): void {
    this.socket.reconnectNow();
  }

  /** Closes the connection and stops re-sending (tests, and before "Delete my data" restarts the app). */
  disconnect(): void {
    this.outbox.stop();
    this.socket.stop();
  }

  getState(): ConnectionState {
    return this.socket.state;
  }

  onState(cb: (s: ConnectionState) => void): Unsubscribe {
    this.ls.state.add(cb);
    cb(this.socket.state);
    return () => this.ls.state.delete(cb);
  }

  onUpdateRequired(cb: () => void): Unsubscribe {
    this.ls.update.add(cb);
    return () => this.ls.update.delete(cb);
  }

  ping(): Promise<number> {
    return this.socket.ping().catch(() => {
      throw new RelayError("offline");
    });
  }

  address(): string {
    return this.deps.url ?? appConfig.relayUrl;
  }

  lastMessageAt(): number | null {
    return this.lastMsg;
  }

  info(): RelayInfo {
    return this.relayInfo;
  }

  clockOffsetMs(): number {
    return this.socket.clockOffsetMs;
  }

  onInfo(cb: (i: RelayInfo) => void): Unsubscribe {
    this.ls.info.add(cb);
    cb(this.relayInfo);
    return () => this.ls.info.delete(cb);
  }

  private setInfo(next: RelayInfo) {
    this.relayInfo = next;
    this.ls.info.forEach((cb) => cb(next));
  }

  private async onLogin(hello: RelayBody<"hello">, ok: RelayBody<"auth.ok">) {
    this.labOptedIn = ok.lab.optedIn;
    this.setInfo({
      env: hello.env,
      gatewayId: hello.gatewayId,
      e2eRequired: hello.e2eRequired,
      pushStatus: ok.pushStatus,
      vapidKeyId: hello.vapidKeyId,
      lab: ok.lab,
      e2e: true,
    });
    const me = this.me ?? (await this.deps.identity());
    // 8.9: re-register the grant and the push subscription, THEN flush the outbox. Everything grant.set needs is
    // worked out first, while the outbox is still held, so nothing queued can overtake it. A "Reset my code"
    // made while offline finishes here: the older grants are revoked only by a rotating grant.set.
    const rotate = (await this.rotationPending()) === me.grantId;
    const hash = await grantHash(me.grantSecret);
    if (!this.socket.isAuthed) return; // dropped meanwhile: the next login starts over
    this.loginReady = true;
    void this.registerGrant(me, rotate, hash).catch(() => {});
    // A subscription the push service rejected (expired) is not revived: the push controller replaces it (11.2).
    if (this.pushSub && ok.pushStatus !== "expired") void this.control("push.subscribe", this.pushSub).catch(() => {});
    this.outbox.flush(true);
  }

  // ─── Frames in ───────────────────────────────────────────────────────────

  private async onFrame(f: RelayFrame) {
    this.lastMsg = Date.now();
    switch (f.t) {
      case "deliver":
        return this.onDeliver(f.id, f.body);
      case "receipt":
        return this.handleReceipt(f.body);
      case "error":
        return this.onError(f.body);
      case "lab.state":
        this.labPeers = new Set(f.body.optedIn);
        this.labOptedIn = this.me ? this.labPeers.has(this.me.deviceId) : this.labOptedIn;
        this.setInfo({ ...this.relayInfo, lab: { optedIn: this.labOptedIn } });
        break;
    }
    // The Security Lab page listens to every lab.* frame (14.2).
    if (f.t.startsWith("lab.")) this.ls.lab.forEach((cb) => cb(f as LabRelayFrame));
    const waiters = this.replies.get(f.t);
    if (waiters?.length) waiters.shift()!(f);
  }

  private handleReceipt(r: RelayBody<"receipt">) {
    const receipt: Receipt = {
      of: r.of,
      state: r.state,
      ...(r.re ? { re: r.re } : {}),
      ...(r.to ? { to: r.to } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
    };
    if (r.state === "accepted" || r.state === "rejected") this.outbox.settle(r.of);
    const w = this.waiting.get(r.of);
    if (w && (r.state === "accepted" || r.state === "rejected")) {
      this.waiting.delete(r.of);
      if (w.timer) clearTimeout(w.timer);
      if (r.state === "accepted") w.resolve(receipt);
      else w.reject(refusal(r.reason));
    }
    this.emit(this.ls.receipt, receipt);
  }

  private onError(e: RelayBody<"error">) {
    // The relay no longer knows this socket as logged in (7.5): log in again. The outbox keeps what was pending.
    if (e.code === "unauthenticated") this.socket.reconnectNow();
    if (!e.of) return;
    if (e.code === "rate_limited" || e.code === "unavailable") {
      // Keep the message and try again later (the relay forgot this id so it may be re-sent). If the wait
      // outlasts the message, it is refused now: an "alert check" limited for 20 minutes says so at once.
      if (this.outbox.holdOff(e.of, e.retryAfterMs ?? 2000)) return;
    }
    this.outbox.settle(e.of);
    const w = this.waiting.get(e.of);
    if (w) {
      this.waiting.delete(e.of);
      if (w.timer) clearTimeout(w.timer);
      w.reject(refusal(e.code));
    }
  }

  /** A delivery: ack at once, drop duplicates and closed requests, open, validate, hand to the app. */
  private async onDeliver(id: string, body: DeliverBody, fromPush = false) {
    if (!fromPush) this.socket.send({ v: 1, t: "ack", id: ulid(), ts: Date.now(), body: { of: id } });
    if (this.alreadySeen(id)) return;
    const me = this.me ?? (await this.deps.identity());
    const receivedAt = Date.now();
    const known = await this.deps.lookupMember(body.from);
    // This app seals everything (FC-7), so it refuses readable envelopes unless its OWN Lab opt-in is on:
    // the relay can't quietly downgrade it (9.5, SEC-05).
    const acceptPlain = this.labOptedIn;

    if (body.kind === "verify.cancel") {
      if (body.re) this.tombstone(body.re);
      if (body.re && body.system) {
        this.emit(this.ls.cancel, { requestId: body.re, reason: body.system.reason, from: body.from });
      }
      return;
    }
    if (body.kind === "verify.request") {
      if (body.re && this.tombstones.has(body.re)) return; // it was cancelled before it arrived
      const o = await unwrap("verify.request", body, id, me, { acceptPlain, knownSenderDk: known?.devicePub });
      // A tampered request can't be answered safely: drop it silently (9.4).
      if (!o.ok) return;
      const w = o.payload.req;
      // FC-27: only requests addressed to me, from the device that actually sent the envelope.
      if (w.toDeviceId !== me.deviceId || w.fromDeviceId !== body.from || w.requestId !== body.re) return;
      if (this.alreadySeen(`req:${w.requestId}`)) return;
      const req: VerifyRequest = {
        requestId: w.requestId,
        nonce: w.nonce,
        fromDeviceId: w.fromDeviceId,
        fromName: o.payload.fromName,
        fromLabel: o.payload.fromName,
        toDeviceId: w.toDeviceId,
        claimedLabel: w.claimedLabel,
        ...(w.reason ? { reason: w.reason } : {}),
        ...(w.amountInr ? { amountInr: w.amountInr } : {}),
        channel: "call",
        createdAt: w.createdAt,
        expiresAt: w.expiresAt,
      };
      this.emit(this.ls.request, {
        req,
        envFrom: body.from,
        ttlMs: body.ttlMs,
        receivedAt,
        senderDevicePub: o.payload.spk,
        senderEncPub: o.payload.sek,
      });
      return;
    }
    if (body.kind === "verify.answer") {
      const o = await unwrap("verify.answer", body, id, me, { acceptPlain, knownSenderDk: known?.devicePub });
      const incoming: IncomingAnswer = {
        sealOk: o.ok,
        envFrom: body.from,
        re: body.re ?? "",
        receivedAt,
        ...(o.ok ? { ans: o.payload.ans } : {}),
        ...(body.late ? { late: true } : {}),
      };
      this.emit(this.ls.answer, incoming);
      return;
    }
    if (body.kind === "alert") {
      const o = await unwrap("alert", body, id, me, { acceptPlain, knownSenderDk: known?.devicePub });
      if (!o.ok) return; // dropped (9.4)
      const a = o.payload.alert;
      this.emit(this.ls.alert, {
        id: a.id,
        type: a.type,
        aboutLabel: a.aboutLabel,
        victimName: a.victimName,
        ...(a.aboutDeviceId ? { aboutDeviceId: a.aboutDeviceId } : {}),
        ...(a.victimPhone ? { victimPhone: a.victimPhone } : {}),
        ...(a.amountInr ? { amountInr: a.amountInr } : {}),
        // Shown as "{ago}" on THIS phone, so it is timed by this phone's clock: the sender's clock may be minutes
        // off and is never compared with this one (8.7).
        createdAt: receivedAt,
        victimDeviceId: body.from,
        read: false,
      });
      return;
    }
    if (body.kind === "guard.prompt") {
      const o = await unwrap("guard.prompt", body, id, me, { acceptPlain, knownSenderDk: known?.devicePub });
      if (!o.ok) return;
      const p = o.payload.prompt;
      this.emit(this.ls.guard, {
        claimedLabel: p.claimedLabel,
        ...(p.claimedDeviceId ? { claimedDeviceId: p.claimedDeviceId } : {}),
        ...(p.amountInr ? { amountInr: p.amountInr } : {}),
        tactics: p.tactics,
        at: p.at,
      });
    }
  }

  private alreadySeen(key: string): boolean {
    const now = Date.now();
    if (this.seenIds.size > 1000) {
      for (const [k, t] of this.seenIds) if (now - t > TIMING.TOMBSTONE_MS) this.seenIds.delete(k);
    }
    if (this.seenIds.has(key)) return true;
    this.seenIds.set(key, now);
    return false;
  }

  private tombstone(requestId: string) {
    const now = Date.now();
    for (const [k, t] of this.tombstones) if (t < now) this.tombstones.delete(k);
    this.tombstones.set(requestId, now + TIMING.TOMBSTONE_MS);
  }

  /** Listeners registered after a delivery arrived still get it (the login drain can beat React's effects). */
  private emit<T>(set: Set<Listener<T>>, v: T) {
    if (set.size === 0) {
      const key = set as Set<Listener<never>>;
      this.pending.set(key, [...(this.pending.get(key) ?? []), v]);
      return;
    }
    set.forEach((cb) => cb(v));
  }

  private subscribe<T>(set: Set<Listener<T>>, cb: Listener<T>): Unsubscribe {
    set.add(cb);
    const key = set as Set<Listener<never>>;
    const queued = (this.pending.get(key) ?? []) as T[];
    this.pending.delete(key);
    queued.forEach((v) => cb(v));
    return () => set.delete(cb);
  }

  // ─── Frames out ──────────────────────────────────────────────────────────

  /** Whether this envelope may travel readable: only between two Lab-opted-in devices (9.5, FC-7). */
  private mode(to: string): "e2e" | "plain" {
    return this.labOptedIn && this.labPeers.has(to) ? "plain" : "e2e";
  }

  private async sendEnvelope(
    kind: SendKind,
    to: { deviceId: string; encPub: string; grant?: string },
    payload: object,
    o: { id?: string; re?: string; ttlMs: number; expiresAt: number; persist?: boolean },
  ): Promise<string> {
    const me = this.me ?? (await this.deps.identity());
    const id = o.id ?? ulid();
    const header = { kind, id, from: me.deviceId, to: to.deviceId, ...(o.re ? { re: o.re } : {}) };
    const sealed = await wrap(payload, header, me, to.encPub, this.mode(to.deviceId));
    const body: ClientBody<"send"> = {
      kind,
      to: to.deviceId,
      ...(o.re ? { re: o.re } : {}),
      ...(to.grant ? { grant: to.grant } : {}),
      ttlMs: o.ttlMs,
      ...sealed,
    } as ClientBody<"send">;
    this.outbox.add({
      id,
      kind,
      frame: { v: 1, t: "send", id, ts: Date.now(), body },
      expiresAt: o.expiresAt,
      persist: o.persist ?? false,
    });
    this.lastMsg = Date.now();
    return id;
  }

  /** Waits for the message's `accepted` receipt (or refusal); rejects after `timeoutMs`. */
  private awaitAccepted(id: string, timeoutMs: number): Promise<Receipt> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new RelayError(this.socket.state === "offline" ? "offline" : "unreachable"));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
    });
  }

  /** A control message through the outbox, confirmed by `receipt { of, accepted }`. */
  private control<T extends ClientType>(t: T, body: ClientBody<T>, timeoutMs = 10_000): Promise<Receipt> {
    const id = ulid();
    // Listen for the receipt BEFORE sending: however fast the relay answers, it can't be missed.
    const accepted = this.awaitAccepted(id, timeoutMs);
    this.outbox.add({
      id,
      kind: t,
      frame: { v: 1, t, id, ts: Date.now(), body },
      expiresAt: Date.now() + timeoutMs,
      persist: false,
    });
    return accepted;
  }

  /**
   * Sends a query and waits for its reply frame (replies come in order). The listener is registered BEFORE the
   * frame goes out, so however fast the relay answers the reply can't be missed; if the frame can't be sent the
   * listener is removed at once, so it can't take the reply meant for the next query.
   */
  private query<T extends RelayFrame["t"]>(
    t: T,
    frame: object,
    timeoutMs = 10_000,
  ): Promise<Extract<RelayFrame, { t: T }>> {
    return new Promise((resolve, reject) => {
      const list = this.replies.get(t) ?? [];
      const remove = () => {
        const i = list.indexOf(cb);
        if (i >= 0) list.splice(i, 1);
      };
      const cb = (f: RelayFrame) => {
        clearTimeout(timer);
        resolve(f as Extract<RelayFrame, { t: T }>);
      };
      const timer = setTimeout(() => {
        remove();
        reject(new RelayError("unreachable"));
      }, timeoutMs);
      list.push(cb);
      this.replies.set(t, list);
      if (!this.socket.send(frame)) {
        clearTimeout(timer);
        remove();
        reject(new RelayError("offline"));
      }
    });
  }

  async sendRequest(req: VerifyRequest, to: RecipientCard): Promise<void> {
    if (this.socket.state === "offline") throw new RelayError("offline");
    const me = this.me ?? (await this.deps.identity());
    const accepted = this.awaitAccepted(req.requestId, TIMING.ACCEPT_TIMEOUT_MS);
    await this.sendEnvelope("verify.request", to, requestPayload(req, me), {
      id: req.requestId, // D-009: the request's frame id is its request id
      re: req.requestId,
      ttlMs: Math.max(0, req.expiresAt - Date.now()),
      expiresAt: req.expiresAt,
    });
    await accepted;
  }

  async sendAnswer(ans: WireAnswer, to: { deviceId: string; encPub: string; devicePub: string }): Promise<void> {
    const me = this.me ?? (await this.deps.identity());
    const id = ulid();
    const accepted = this.awaitAccepted(id, ANSWER_RETRY_MS);
    await this.sendEnvelope("verify.answer", to, answerPayload(ans, me), {
      id,
      re: ans.requestId,
      ttlMs: 0, // ignored for answers: the relay applies the request record's deadline and grace
      expiresAt: Date.now() + ANSWER_RETRY_MS,
      persist: true,
    });
    await accepted;
  }

  async sendAlert(alert: FamilyAlert, to: RecipientCard[]) {
    const me = this.me ?? (await this.deps.identity());
    const payload = alertPayload(alert, me);
    const out: Array<{ deviceId: string; msgId: string }> = [];
    for (const r of to) {
      const msgId = await this.sendEnvelope("alert", r, payload, {
        ttlMs: ALERT_TTL_MS,
        expiresAt: Date.now() + ALERT_TTL_MS,
      });
      out.push({ deviceId: r.deviceId, msgId });
    }
    return out;
  }

  async sendGuardPrompt(p: GuardPrompt, to: RecipientCard): Promise<void> {
    const me = this.me ?? (await this.deps.identity());
    const id = ulid();
    const accepted = this.awaitAccepted(id, TIMING.ACCEPT_TIMEOUT_MS * 2);
    await this.sendEnvelope("guard.prompt", to, promptPayload(p, me), {
      id,
      ttlMs: PROMPT_TTL_MS,
      expiresAt: Date.now() + PROMPT_TTL_MS,
    });
    await accepted;
  }

  async cancelRequest(requestId: string): Promise<void> {
    this.tombstone(requestId);
    // Not sent yet (no `accepted`)? Stop re-sending it, so it can't reach them after the asker gave up.
    this.outbox.settle(requestId);
    const w = this.waiting.get(requestId);
    if (w) {
      this.waiting.delete(requestId);
      if (w.timer) clearTimeout(w.timer);
      w.reject(new RelayError("unreachable"));
    }
    await this.control("cancel", { re: requestId }).catch(() => {});
  }

  markSeen(requestId: string): void {
    this.socket.send({ v: 1, t: "seen", id: ulid(), ts: Date.now(), body: { re: requestId } });
  }

  async queryPresence(deviceIds: string[]): Promise<Record<string, PresenceState>> {
    const ids = [...new Set(deviceIds)].slice(0, 50);
    if (ids.length === 0) return {};
    const r = await this.query("presence", { v: 1, t: "presence.query", id: ulid(), ts: Date.now(), body: { ids } });
    const states = r.body.states as Record<string, PresenceState>;
    for (const id of ids) {
      if (states[id] === "online" || states[id] === "push") this.reachable.add(id);
      else this.reachable.delete(id);
    }
    const list = [...this.reachable].sort();
    this.ls.presence.forEach((cb) => cb(list));
    return states;
  }

  pushSubscribe(sub: PushSubscriptionInfo): void {
    this.pushSub = sub;
    void this.control("push.subscribe", sub).catch(() => {});
  }

  async contacts(): Promise<Contact[]> {
    const r = await this.query("contact.list.result", {
      v: 1,
      t: "contact.list",
      id: ulid(),
      ts: Date.now(),
      body: {},
    });
    return r.body.contacts;
  }

  async revokeContact(deviceId: string): Promise<void> {
    await this.control("contact.revoke", { deviceId });
  }

  async unrevokeContact(deviceId: string): Promise<void> {
    await this.control("contact.unrevoke", { deviceId });
  }

  /** "Reset my code" (6.4). The new grant is used at once; if the relay can't be told now, the next login
   *  finishes the rotation (the pending mark survives a reload). */
  async rotateGrant(): Promise<string> {
    const next = await this.deps.rotateLocalGrant();
    this.me = next;
    await this.deps.db.meta.put({ key: "grant:rotatePending", value: next.grantId });
    // Offline: don't keep the person waiting. The pending mark makes the next login finish the rotation.
    if (this.socket.state === "connected") await this.registerGrant(next, true).catch(() => {});
    return `${next.grantId}.${next.grantSecret}`;
  }

  private async rotationPending(): Promise<string | undefined> {
    return (await this.deps.db.meta.get("grant:rotatePending"))?.value as string | undefined;
  }

  private async registerGrant(me: IdentityRow, rotate: boolean, hash?: string): Promise<void> {
    await this.control("grant.set", { grantId: me.grantId, hash: hash ?? (await grantHash(me.grantSecret)), rotate });
    if (rotate && (await this.rotationPending()) === me.grantId) await this.deps.db.meta.delete("grant:rotatePending");
  }

  async retire(): Promise<void> {
    await this.control("device.retire", {});
  }

  async sendTestAlert(): Promise<void> {
    await this.control("push.test", {});
  }

  // ─── Security Lab page (14.2) ────────────────────────────────────────────

  /** Every lab.* frame from the relay (state, traffic, held messages, results). */
  onLabFrame(cb: (f: LabRelayFrame) => void): Unsubscribe {
    this.ls.lab.add(cb);
    return () => this.ls.lab.delete(cb);
  }

  /** A Lab page command; rejects with the relay's reason (lab_denied, lab_disabled, rate_limited…). */
  async labCommand<T extends LabCommand>(t: T, body: ClientBody<T>): Promise<void> {
    await this.control(t, body);
  }

  reportVerdict(r: Parameters<RelayService["reportVerdict"]>[0]): void {
    // lab.report is only meaningful (and only accepted) while this phone is opted in to the Lab (14.2).
    if (!this.labOptedIn) return;
    this.socket.send({ v: 1, t: "lab.report", id: ulid(), ts: Date.now(), body: r });
  }

  async labOptIn(password: string): Promise<void> {
    await this.control("lab.optin", { password });
    this.labOptedIn = true;
    this.setInfo({ ...this.relayInfo, lab: { optedIn: true } });
  }

  async labOptOut(): Promise<void> {
    await this.control("lab.optout", {});
    this.labOptedIn = false;
    this.labPeers.clear();
    this.setInfo({ ...this.relayInfo, lab: { optedIn: false } });
  }

  announce(): void {
    /* the real relay knows no names (0, rule 5) */
  }

  onPeers(cb: (peers: PeerInfo[]) => void): Unsubscribe {
    cb([]);
    return () => {};
  }

  // ─── Push inbox (11.5) ───────────────────────────────────────────────────

  /** Frames the service worker received by push. Each is handled once (dedupe by id), like a live delivery. */
  async drainPushInbox(): Promise<void> {
    const rows = await this.deps.db.pushInbox.orderBy("at").toArray();
    for (const row of rows) {
      await this.deps.db.pushInbox.delete(row.id);
      const f = row.frame as { t?: string; id?: string; body?: DeliverBody };
      if (f?.t === "deliver" && f.id && f.body) await this.onDeliver(f.id, f.body, true);
    }
  }

  private listenToServiceWorker() {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
      const data = e.data as { type?: string } | null;
      if (data?.type === "push-frame") void this.drainPushInbox();
      if (data?.type === "navigate") this.socket.reconnectNow();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.drainPushInbox();
    });
  }

  // ─── Listeners ───────────────────────────────────────────────────────────

  onPresence(cb: (ids: string[]) => void): Unsubscribe {
    this.ls.presence.add(cb);
    cb([...this.reachable]);
    return () => this.ls.presence.delete(cb);
  }

  onRequest(cb: (r: IncomingRequest) => void): Unsubscribe {
    return this.subscribe(this.ls.request, cb);
  }

  onAnswer(cb: (a: IncomingAnswer) => void): Unsubscribe {
    return this.subscribe(this.ls.answer, cb);
  }

  onAlert(cb: (alert: FamilyAlert) => void): Unsubscribe {
    return this.subscribe(this.ls.alert, cb);
  }

  onGuardPrompt(cb: (p: GuardPrompt) => void): Unsubscribe {
    return this.subscribe(this.ls.guard, cb);
  }

  onReceipt(cb: (r: Receipt) => void): Unsubscribe {
    this.ls.receipt.add(cb);
    return () => this.ls.receipt.delete(cb);
  }

  onCancel(cb: (c: CancelNotice) => void): Unsubscribe {
    return this.subscribe(this.ls.cancel, cb);
  }
}

/** A refusal code → the app's error: `not_allowed`/`unknown_target` end D3 with FC-13's line. */
function refusal(code?: string): RelayError {
  return new RelayError(code === "not_allowed" || code === "unknown_target" ? "not_allowed" : "rejected", code);
}
