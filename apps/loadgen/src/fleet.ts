// A fleet of simulated phones: fresh software identities, connected at a steady rate (the relay's per-IP upgrade
// limit and a real morning both look like a ramp, not a wall).
import type { Endpoint } from "@pehchaan/canary/client";
import { loadDevice, newIdentity } from "@pehchaan/canary/device";
import { Session } from "./session";

export async function newSession(ep: Endpoint): Promise<Session> {
  return new Session(await loadDevice(await newIdentity()), ep);
}

export class Fleet {
  readonly sessions: Session[] = [];
  private stopped = false;

  constructor(private ep: Endpoint) {}

  /** Adds `count` sessions at `perSec` per second. Resolves when all have been started (not necessarily ready). */
  async grow(count: number, perSec: number): Promise<void> {
    const gapMs = 1000 / Math.max(1, perSec);
    for (let i = 0; i < count && !this.stopped; i++) {
      const s = await newSession(this.ep);
      this.sessions.push(s);
      void s.start();
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  get ready(): number {
    let n = 0;
    for (const s of this.sessions) if (s.ready) n++;
    return n;
  }

  get logins(): number {
    let n = 0;
    for (const s of this.sessions) n += s.logins;
    return n;
  }

  stop(): void {
    this.stopped = true;
    for (const s of this.sessions) s.stop();
  }
}
