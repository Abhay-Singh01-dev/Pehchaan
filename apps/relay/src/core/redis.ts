// Valkey (Redis protocol) clients and the Lua commands (spec 15.1, B5).
//
// Fail closed: commands are never queued while disconnected (enableOfflineQueue: false). A command that
// can't run throws, and the relay answers `unavailable` instead of guessing (15.5, 23).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Redis, type RedisOptions } from "ioredis";

/** The Lua scripts, each in its own file under apps/relay/lua (loaded with defineCommand, B5). */
export const LUA = {
  inboxPut: { file: "inbox-put.lua", keys: 2 },
  inboxAck: { file: "inbox-ack.lua", keys: 2 },
  answerCheck: { file: "answer-check.lua", keys: 1 },
  requestCreate: { file: "request-create.lua", keys: 1 },
  openReserve: { file: "open-reserve.lua", keys: 1 },
  cancelRequest: { file: "cancel.lua", keys: 1 },
  gcra: { file: "gcra.lua", keys: 1 },
  labTakeArmed: { file: "lab-take-armed.lua", keys: 1 },
} as const;

export function luaDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/core/redis.ts → ../../lua ; dist/main.js (bundled) → ../lua
  return here.endsWith("core") ? join(here, "..", "..", "lua") : join(here, "..", "lua");
}

type Cmd<A extends unknown[], R> = (...args: A) => Promise<R>;

/** The command client with the Lua scripts attached. */
export interface RelayRedis extends Redis {
  inboxPut: Cmd<[string, string, string, number, string, number, number, number], number>;
  inboxAck: Cmd<[string, string, string], string | null>;
  answerCheck: Cmd<[string, string, string, number, number], [string, string, string]>;
  requestCreate: Cmd<[string, string, string, number, number, number], string>;
  openReserve: Cmd<[string, string, number, number, number, number], number>;
  cancelRequest: Cmd<[string, string], [string, string]>;
  gcra: Cmd<[string, number, number, number], number>;
  labTakeArmed: Cmd<[string, string, string, string], string | null>;
}

export function redisOptions(extra: RedisOptions = {}): RedisOptions {
  return {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    // Keep retrying forever with a capped backoff; routes rebuild themselves on reconnect (15.4).
    retryStrategy: (times) => Math.min(100 * 2 ** times, 2000),
    ...extra,
  };
}

export function createCommandClient(url: string): RelayRedis {
  const client = new Redis(url, redisOptions()) as RelayRedis;
  const dir = luaDir();
  for (const [name, def] of Object.entries(LUA)) {
    client.defineCommand(name, { numberOfKeys: def.keys, lua: readFileSync(join(dir, def.file), "utf8") });
  }
  // Connection errors are handled by callers (fail closed) and by the readiness check; without a listener,
  // ioredis would print every reconnect attempt.
  client.on("error", () => {});
  return client;
}

export function createSubscriberClient(url: string): Redis {
  // A subscriber may queue its SUBSCRIBE commands until it is connected, and resubscribes on reconnect.
  const client = new Redis(url, redisOptions({ enableOfflineQueue: true, maxRetriesPerRequest: null }));
  client.on("error", () => {});
  return client;
}
