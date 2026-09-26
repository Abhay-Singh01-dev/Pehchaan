// Pub/sub between relay processes (spec 8.2, 15.1), behind a small interface so a single Valkey node
// (PUBLISH/SUBSCRIBE) can later become a cluster (SPUBLISH/SSUBSCRIBE) with no change elsewhere.
// Pub/sub is at-most-once; the inbox holds the durable copy, so a lost bus message costs nothing (20.3).
import type { Redis } from "ioredis";
import type { RelayRedis } from "./redis";

export interface Bus {
  subscribe(channel: string, handler: (msg: unknown) => void): Promise<void>;
  publish(channel: string, msg: unknown): Promise<void>;
  close(): Promise<void>;
}

export function createBus(pub: RelayRedis, sub: Redis): Bus {
  const handlers = new Map<string, (msg: unknown) => void>();
  sub.on("message", (channel: string, raw: string) => {
    const h = handlers.get(channel);
    if (!h) return;
    try {
      h(JSON.parse(raw));
    } catch {
      /* a malformed bus message is dropped: the inbox still holds the envelope */
    }
  });
  return {
    async subscribe(channel, handler) {
      handlers.set(channel, handler);
      await sub.subscribe(channel);
    },
    async publish(channel, msg) {
      await pub.publish(channel, JSON.stringify(msg));
    },
    async close() {
      handlers.clear();
      sub.disconnect();
    },
  };
}
