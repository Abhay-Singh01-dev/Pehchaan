// createRelay(config): one relay process (a "gateway"). Stateless by design (0, rule 2): the only memory is
// its own sockets; everything shared lives in Valkey (seconds to minutes) or Postgres (durable). Any number
// of gateways can serve any phone. Nothing is kept at module level, so tests run several in one process.
import { randomBytes } from "node:crypto";
import type { DestinationStream } from "pino";
import { ulid } from "@pehchaan/protocol";
import type { Config } from "./config";
import { createAbuseSignals } from "./core/abuse";
import { createAudit } from "./core/audit";
import { createBus } from "./core/bus";
import { createContacts } from "./core/contacts";
import { createDedupe } from "./core/dedupe";
import { createDevices } from "./core/devices";
import { createInbox } from "./core/inbox";
import { createKeys } from "./core/keys";
import { createRateLimiter } from "./core/ratelimit";
import { createCommandClient, createSubscriberClient } from "./core/redis";
import { createRequests } from "./core/requests";
import { createRetire } from "./core/retire";
import { createRouter, type BusMessage } from "./core/router";
import { createHttpServer, createMetricsServer } from "./http/server";
import type { Hub } from "./hub";
import { createLogger, hmacId } from "./log";
import { createMetrics } from "./metrics";
import { noPush, type Push } from "./push/push";
import { createWebPush } from "./push/sender";
import { createSubscriptions } from "./push/subscriptions";
import { createStore } from "./store/db";
import type { Connection } from "./ws/connection";
import { Sessions } from "./ws/sessions";
import { createUpgradeHandler } from "./ws/upgrade";
import type { LabModule } from "./lab/lab";

const HEARTBEAT_MS = 10_000;

export interface RelayOptions {
  logDestination?: DestinationStream;
  /** Web Push sender (push/sender.ts). Default: none, every push is `queued`. */
  push?: (hub: Hub) => Push;
  /** The Security Lab module (lab/module.ts), created only when LAB_ENABLED. */
  lab?: (hub: Hub) => LabModule;
}

export interface Relay {
  hub: Hub;
  gatewayId: string;
  port: number;
  metricsPort: number;
  /** SIGTERM behaviour (18.9): readiness off, wait for Caddy, spread reconnects, then close. */
  drain(): Promise<void>;
  /** Immediate shutdown (tests, and the end of a drain). */
  stop(): Promise<void>;
  /** Closes local sockets without draining (simulates a crash for tests). */
  crash(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createRelay(config: Config, opts: RelayOptions = {}): Promise<Relay> {
  const gatewayId = `${config.GATEWAY_NAME}-${randomBytes(3).toString("hex")}`;
  const log = createLogger({ level: config.LOG_LEVEL, gatewayId, destination: opts.logDestination });
  const metrics = createMetrics();
  const keys = createKeys(config.KEY_PREFIX);
  const redis = createCommandClient(config.REDIS_URL);
  const sub = createSubscriberClient(config.REDIS_URL);
  const store = createStore({ url: config.DATABASE_URL, schema: config.PG_SCHEMA });
  const audit = createAudit(store.db, config.AUDIT_KEY);
  const abuse = createAbuseSignals({ redis, keys, audit });
  const limiter = createRateLimiter({
    redis,
    keys,
    profile: config.RATE_LIMIT_PROFILE,
    ipHashKey: config.IP_HASH_KEY,
    onLimited: (scope, key) => {
      metrics.rateLimited.inc({ scope });
      abuse.rateLimited(scope, key);
    },
  });
  const sessions = new Sessions<Connection>();
  const bus = createBus(redis, sub);
  const inbox = createInbox(redis, keys);
  const devices = createDevices({ redis, keys, db: store.db, audit });
  const timers = new Set<NodeJS.Timeout>();

  const hub = {
    config,
    gatewayId,
    keys,
    redis,
    sub,
    store,
    log,
    metrics,
    limiter,
    dedupe: createDedupe(redis, keys),
    requests: createRequests(redis, keys),
    inbox,
    devices,
    contacts: createContacts({ redis, keys, db: store.db, audit, limiter, onBindingCreated: abuse.bindingCreated }),
    audit,
    bus,
    sessions,
    push: noPush,
    subscriptions: createSubscriptions({ db: store.db, redis, keys }),
    lab: null,
    state: { draining: false, redisReady: false, refuseUpgrades: false },
    hmac: (id: string) => hmacId(config.AUDIT_KEY, id),
  } as unknown as Hub;

  hub.router = createRouter({
    gatewayId,
    redis,
    keys,
    bus,
    inbox,
    push: () => hub.push,
    sockets: (id) => sessions.get(id),
    ackFallbackMs: config.ACK_PUSH_FALLBACK_MS,
    metrics,
    log,
    onLatePush: (stored, to, outcome) => {
      if (stored.frame.body.kind === "verify.cancel") return;
      metrics.receipts.inc({ state: outcome });
      const body = stored.frame.body;
      void hub.router
        .notify(body.from, {
          v: 1,
          t: "receipt",
          id: ulid(),
          sts: Date.now(),
          body: { of: stored.frame.id, to, ...(typeof body.re === "string" ? { re: body.re } : {}), state: outcome },
        })
        .catch(() => {});
    },
  });
  hub.retire = createRetire({ db: store.db, redis, keys, bus, audit });
  hub.pushTest = (deviceId, msgId) => {
    const t = setTimeout(() => {
      timers.delete(t);
      void hub.push
        .sendTest(deviceId)
        .then((state) =>
          hub.router.notify(deviceId, { v: 1, t: "receipt", id: ulid(), sts: Date.now(), body: { of: msgId, state } }),
        )
        .catch(() => {});
    }, config.PUSH_TEST_DELAY_MS);
    timers.add(t);
  };
  if (opts.push) hub.push = opts.push(hub);
  else if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    // Web Push (11): the current key, and during a rotation the previous one (11.9).
    const vapid = [
      { id: config.VAPID_KEY_ID, publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY },
    ];
    if (config.VAPID_PREVIOUS_KEY_ID && config.VAPID_PREVIOUS_PUBLIC_KEY && config.VAPID_PREVIOUS_PRIVATE_KEY) {
      vapid.push({
        id: config.VAPID_PREVIOUS_KEY_ID,
        publicKey: config.VAPID_PREVIOUS_PUBLIC_KEY,
        privateKey: config.VAPID_PREVIOUS_PRIVATE_KEY,
      });
    }
    hub.push = createWebPush({
      subscriptions: hub.subscriptions,
      keys: vapid,
      subject: config.VAPID_SUBJECT,
      metrics,
      log,
      ...(config.PUSH_TEST_TARGET ? { testTarget: config.PUSH_TEST_TARGET } : {}),
    });
  }
  // 14.1 layer 1: the Lab module's code is loaded only in a build that enables it.
  if (config.LAB_ENABLED) hub.lab = (opts.lab ?? (await import("./lab/module")).createLabModule)(hub);

  // ── Valkey: connect, keep this gateway's liveness key fresh, and rebuild routes after a restart (15.4).
  const rehydrate = async () => {
    hub.state.redisReady = true;
    try {
      await hub.router.heartbeat();
      for (const d of sessions.devices()) await hub.router.addRoute(d);
    } catch {
      /* the next heartbeat retries */
    }
  };
  redis.on("ready", () => void rehydrate());
  redis.on("close", () => (hub.state.redisReady = false));
  await redis.connect();
  await sub.connect();
  await rehydrate();
  timers.add(
    setInterval(() => {
      void hub.router.heartbeat().catch(() => (hub.state.redisReady = false));
    }, HEARTBEAT_MS),
  );

  // ── Pub/sub: deliveries for devices on this gateway, and admin actions (16.8).
  await bus.subscribe(keys.gatewayChannel(gatewayId), (m) => {
    const msg = m as BusMessage;
    if (msg.type === "deliver") hub.router.localDeliver(msg.to, msg.stored, msg.push);
    else if (msg.type === "notify") {
      const text = JSON.stringify(msg.frame);
      for (const s of sessions.get(msg.to)) s.sendText(text);
    }
  });
  await bus.subscribe(keys.adminChannel(), (m) => {
    const msg = m as { t: string; deviceId: string; code: number };
    if (msg.t === "kick") for (const s of [...sessions.get(msg.deviceId)]) s.close(msg.code, "blocked");
  });
  if (hub.lab) await hub.lab.start();

  // ── HTTP and WebSockets.
  const onGone = (c: Connection) => {
    if (!c.deviceId) return;
    metrics.wsConnections.dec({ platform: c.platform });
    hub.lab?.onClose(c);
    if (sessions.remove(c)) void hub.router.removeRoute(c.deviceId).catch(() => {});
  };
  const upgrade = createUpgradeHandler(hub, { onGone });
  const http = await createHttpServer(hub, { socketCount: () => sessions.count + upgrade.unauthenticatedCount() });
  http.server.on("upgrade", (req, socket, head) => upgrade.handle(req, socket, head));
  await http.listen({ port: config.PORT, host: config.BIND_HOST });
  const metricsServer = await createMetricsServer(hub);
  await metricsServer.listen({ port: config.METRICS_PORT, host: config.BIND_HOST });
  const addr = (s: typeof http) => {
    const a = s.server.address();
    return typeof a === "object" && a ? a.port : 0;
  };
  log.info(
    { port: addr(http), env: config.ENV_NAME, e2eRequired: config.E2E_REQUIRED, lab: Boolean(hub.lab) },
    "relay up",
  );

  let stopped: Promise<void> | null = null;
  const stop = () =>
    (stopped ??= (async () => {
      hub.state.draining = true;
      hub.state.refuseUpgrades = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      hub.router.stop();
      for (const c of [...sessions.sockets(), ...upgrade.unauthenticated()]) c.close(1001, "shutting down");
      upgrade.wss.close();
      await Promise.allSettled([http.close(), metricsServer.close()]);
      if (hub.lab) await hub.lab.stop().catch(() => {});
      await redis.del(keys.gatewayAlive(gatewayId)).catch(() => {});
      await Promise.allSettled([bus.close(), hub.push.close()]);
      redis.disconnect();
      await store.close().catch(() => {});
      log.info("relay stopped");
    })());

  return {
    hub,
    gatewayId,
    port: addr(http),
    metricsPort: addr(metricsServer),
    stop,

    async drain() {
      // 1. Readiness off at once: Caddy's 5 s health check takes this container out of rotation.
      hub.state.draining = true;
      log.info({ sockets: sessions.count }, "draining");
      await sleep(config.DRAIN_SETTLE_MS);
      // 2. Almost no new upgrade ever sees this 503 (Caddy only retries dial errors).
      hub.state.refuseUpgrades = true;
      // 3. Ask every phone to reconnect, spread over at most 5 s so they don't all arrive at once.
      const spreadMs = Math.min(5000, sessions.count);
      for (const s of sessions.sockets()) s.send("reconnect", { afterMs: Math.floor(Math.random() * spreadMs) });
      // 4. Phones leave on their own; after DRAIN_TIMEOUT_MS the rest are closed with 1012.
      const deadline = Date.now() + config.DRAIN_TIMEOUT_MS;
      while (sessions.count > 0 && Date.now() < deadline) await sleep(100);
      for (const s of sessions.sockets()) s.close(1012, "restart");
      await stop();
    },

    async crash() {
      for (const c of [...sessions.sockets(), ...upgrade.unauthenticated()]) c.ws.terminate();
      await stop();
    },
  };
}
