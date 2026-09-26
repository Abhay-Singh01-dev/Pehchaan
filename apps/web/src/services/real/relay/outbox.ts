// The outbox (backend spec 8.4): every `send` (and every control message) is kept and re-sent with the SAME id
// every 2 s until the relay confirms it (`accepted`) or refuses it, or its time runs out. The relay deduplicates
// by (sender, id), so re-sending is always safe. Answers are kept in IndexedDB too, so a reload can't lose one.
//
// Each message has its own retry timer, so every re-send comes exactly 2 s after the previous attempt, whenever
// the message was added (a shared ticking loop could make the first retry wait up to 4 s).
import { TIMING } from "@pehchaan/protocol";
import type { PehchaanDB } from "@/store/db";

export interface OutboxEntry {
  id: string;
  kind: string;
  frame: object;
  expiresAt: number;
  persist: boolean;
  /** Not before this time (a rate limit's retryAfterMs). */
  notBefore: number;
  lastSent: number;
}

export class Outbox {
  private entries = new Map<string, OutboxEntry>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private running = false;

  constructor(
    private send: (frame: object) => boolean,
    private db: PehchaanDB | null,
    private onExpired: (e: OutboxEntry) => void,
  ) {}

  /** Starts re-sending (after the answers left from before a reload are loaded). */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (const e of this.entries.values()) this.schedule(e, 0);
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Answers left over from before a reload. */
  async load(): Promise<void> {
    if (!this.db) return;
    const now = Date.now();
    for (const row of await this.db.outbox.toArray()) {
      if (row.expiresAt <= now) {
        await this.db.outbox.delete(row.id);
        continue;
      }
      const entry: OutboxEntry = {
        id: row.id,
        kind: row.kind,
        frame: JSON.parse(row.frame) as object,
        expiresAt: row.expiresAt,
        persist: true,
        notBefore: 0,
        lastSent: 0,
      };
      this.entries.set(row.id, entry);
      if (this.running) this.schedule(entry, 0);
    }
  }

  add(e: Omit<OutboxEntry, "notBefore" | "lastSent">): void {
    const entry: OutboxEntry = { ...e, notBefore: 0, lastSent: 0 };
    this.entries.set(e.id, entry);
    if (e.persist && this.db) {
      void this.db.outbox.put({
        id: e.id,
        kind: e.kind,
        frame: JSON.stringify(e.frame),
        expiresAt: e.expiresAt,
        createdAt: Date.now(),
      });
    }
    this.attempt(entry);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** The relay answered for this message: stop re-sending. */
  settle(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    if (e.persist && this.db) void this.db.outbox.delete(id);
  }

  /** A rate limit or `unavailable`: try again after the given time. Returns false (keeping nothing) when the
   *  message would expire before then, so the caller can report the refusal now instead of timing out later. */
  holdOff(id: string, ms: number): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    if (Date.now() + ms >= e.expiresAt) {
      this.settle(id);
      return false;
    }
    e.notBefore = Date.now() + ms;
    this.schedule(e, ms);
    return true;
  }

  /** Sends what is due now; `force` (after a login) sends everything not held off, at once. The relay
   *  deduplicates by id, so a message that also just went out is harmless. */
  flush(force = false): void {
    const now = Date.now();
    for (const e of [...this.entries.values()]) {
      if (e.expiresAt <= now || e.notBefore > now) {
        if (e.expiresAt <= now) this.attempt(e);
        continue;
      }
      if (force || now - e.lastSent >= TIMING.OUTBOX_RETRY_MS) this.attempt(e);
    }
  }

  /** One try: expire, wait out a hold-off, or send; then the next try comes one retry period later. */
  private attempt(e: OutboxEntry): void {
    if (!this.entries.has(e.id)) return;
    const now = Date.now();
    if (e.expiresAt <= now) {
      this.settle(e.id);
      this.onExpired(e);
      return;
    }
    if (e.notBefore > now) return this.schedule(e, e.notBefore - now);
    // Not logged in: the send is refused, and the next login's flush (or the next retry) sends it.
    if (this.send(e.frame)) e.lastSent = now;
    this.schedule(e, TIMING.OUTBOX_RETRY_MS);
  }

  private schedule(e: OutboxEntry, delayMs: number): void {
    const old = this.timers.get(e.id);
    if (old) clearTimeout(old);
    this.timers.delete(e.id);
    if (!this.running) return;
    // Never later than the message's own expiry, so it is dropped (and reported) on time.
    const delay = Math.max(0, Math.min(delayMs, e.expiresAt - Date.now()));
    this.timers.set(
      e.id,
      setTimeout(() => this.attempt(e), delay),
    );
  }
}
