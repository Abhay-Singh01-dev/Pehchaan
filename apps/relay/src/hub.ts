// Everything a relay process shares between its connections: configuration, stores and the core services.
// One Hub per createRelay() call; nothing lives at module level (D-016).
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Config } from "./config";
import type { Audit } from "./core/audit";
import type { Bus } from "./core/bus";
import type { Contacts } from "./core/contacts";
import type { Dedupe } from "./core/dedupe";
import type { Devices } from "./core/devices";
import type { Inbox } from "./core/inbox";
import type { Keys } from "./core/keys";
import type { RateLimiter } from "./core/ratelimit";
import type { RelayRedis } from "./core/redis";
import type { Requests } from "./core/requests";
import type { Router } from "./core/router";
import type { LabModule } from "./lab/lab";
import type { Metrics } from "./metrics";
import type { Push } from "./push/push";
import type { Subscriptions } from "./push/subscriptions";
import type { Store } from "./store/db";
import type { Connection } from "./ws/connection";
import type { Sessions } from "./ws/sessions";

export interface Hub {
  config: Config;
  gatewayId: string;
  keys: Keys;
  redis: RelayRedis;
  sub: Redis;
  store: Store;
  log: Logger;
  metrics: Metrics;
  limiter: RateLimiter;
  dedupe: Dedupe;
  requests: Requests;
  inbox: Inbox;
  devices: Devices;
  contacts: Contacts;
  audit: Audit;
  bus: Bus;
  router: Router;
  sessions: Sessions<Connection>;
  push: Push;
  subscriptions: Subscriptions;
  /** Tombstones a device and deletes what the relay holds about it (6.6). */
  retire(deviceId: string, by?: "device" | "admin"): Promise<void>;
  /** Diagnostics "Send test alert": pushes a test notification to the device after 10 s (11.8). */
  pushTest(deviceId: string, msgId: string): void;
  /** Loaded only when LAB_ENABLED (14.1). */
  lab: LabModule | null;
  state: { draining: boolean; redisReady: boolean; refuseUpgrades: boolean };
  /** The pseudonymous form of a device ID for logs (16.7). */
  hmac(deviceId: string): string;
}
