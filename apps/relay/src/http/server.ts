// The relay's few HTTP routes (spec 3.1, 18.9, 19): health, readiness, time and public config on PORT;
// Prometheus metrics on METRICS_PORT (never published outside the private network).
// There are no admin HTTP endpoints: admin tasks run over SSH with dist/admin.js (16.4).
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { Hub } from "../hub";

export interface HttpOptions {
  /** Sockets currently open, including unauthenticated ones (for MAX_SOCKETS). */
  socketCount: () => number;
}

export async function createHttpServer(hub: Hub, o: HttpOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 16 * 1024 });
  await app.register(cors, { origin: hub.config.PUBLIC_ORIGINS, methods: ["GET", "POST"], maxAge: 600 });

  /** Liveness: the process is running. Docker restarts a container that fails this. */
  app.get("/healthz", async () => ({ ok: true }));

  /** Readiness: fails while draining, when Valkey is down, or at MAX_SOCKETS, so Caddy sends new connections
   *  to the other relay container (18.6, 18.9, REL-24). */
  app.get("/readyz", async (_req, reply) => {
    const reasons: string[] = [];
    if (hub.state.draining) reasons.push("draining");
    if (!hub.state.redisReady) reasons.push("valkey");
    if (o.socketCount() >= hub.config.MAX_SOCKETS) reasons.push("full");
    if (reasons.length) return reply.code(503).send({ ready: false, reasons });
    return { ready: true };
  });

  /** The relay's clock (apps keep an offset for display only, 8.7). */
  app.get("/v1/time", async () => ({ serverTime: Date.now() }));

  /** What an app needs to know about this relay before it connects. Nothing secret. */
  app.get("/v1/config", async () => ({
    env: hub.config.ENV_NAME,
    minClient: hub.config.MIN_CLIENT_VERSION,
    e2eRequired: hub.config.E2E_REQUIRED,
    vapidPublicKey: hub.config.VAPID_PUBLIC_KEY ?? null,
    vapidKeyId: hub.config.VAPID_KEY_ID,
    lab: hub.lab !== null,
  }));

  return app;
}

export async function createMetricsServer(hub: Hub): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", hub.metrics.registry.contentType);
    return hub.metrics.registry.metrics();
  });
  return app;
}
