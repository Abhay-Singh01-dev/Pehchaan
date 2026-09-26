// The only thing a gateway keeps in memory: which of ITS sockets belong to which device (spec 2.1).
// Up to 3 sockets per device (the installed app plus a browser tab, say); a 4th replaces the oldest (7.1).
import { LIMITS } from "@pehchaan/protocol";

export interface SessionSocket {
  readonly connId: number;
  readonly deviceId: string | null;
  readonly openedAt: number;
}

export class Sessions<S extends SessionSocket> {
  private byDevice = new Map<string, S[]>();
  private all = new Set<S>();

  /** Registers an authenticated socket. Returns the socket it replaces, if the device already had 3. */
  add(s: S): S | null {
    const id = s.deviceId!;
    const list = this.byDevice.get(id) ?? [];
    list.push(s);
    this.byDevice.set(id, list);
    this.all.add(s);
    if (list.length > LIMITS.SOCKETS_PER_DEVICE) {
      const oldest = list.shift()!;
      this.all.delete(oldest);
      return oldest;
    }
    return null;
  }

  /** Unregisters a socket. True if it was the device's last socket on this gateway. */
  remove(s: S): boolean {
    if (!this.all.delete(s) || !s.deviceId) return false;
    const list = (this.byDevice.get(s.deviceId) ?? []).filter((x) => x !== s);
    if (list.length === 0) {
      this.byDevice.delete(s.deviceId);
      return true;
    }
    this.byDevice.set(s.deviceId, list);
    return false;
  }

  get(deviceId: string): readonly S[] {
    return this.byDevice.get(deviceId) ?? [];
  }

  devices(): string[] {
    return [...this.byDevice.keys()];
  }

  sockets(): S[] {
    return [...this.all];
  }

  get count(): number {
    return this.all.size;
  }
}
