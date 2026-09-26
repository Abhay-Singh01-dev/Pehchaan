// The admin CLI (spec 16.8), run inside a relay container over SSH:
//   docker compose exec relay-a node dist/admin.js block <deviceId> --reason "spam"
//   … unblock <deviceId> · retire <deviceId> · stats · lab on|off · retention
import { loadConfig } from "./config";
import { createAdmin } from "./admin/commands";
import { createAudit } from "./core/audit";
import { createBus } from "./core/bus";
import { createKeys } from "./core/keys";
import { createCommandClient, createSubscriberClient } from "./core/redis";
import { createRetire } from "./core/retire";
import { createStore } from "./store/db";

const USAGE = `usage: admin.js <command>
  block <deviceId> [--reason "…"]   refuse logins and close its sockets (4403)
  unblock <deviceId>
  retire <deviceId>                  tombstone and delete (deletion requests, 24.7)
  stats                              counts only
  lab on | lab off                   the Security Lab runtime switch (14.1)
  retention                          apply the 15.3 retention rules now`;

const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

const [cmd, arg, ...rest] = process.argv.slice(2);
const config = loadConfig();
const store = createStore({ url: config.DATABASE_URL, schema: config.PG_SCHEMA, max: 2 });
const redis = createCommandClient(config.REDIS_URL);
const sub = createSubscriberClient(config.REDIS_URL);
await redis.connect();
const keys = createKeys(config.KEY_PREFIX);
const bus = createBus(redis, sub);
const audit = createAudit(store.db, config.AUDIT_KEY);
const admin = createAdmin({
  store,
  redis,
  keys,
  bus,
  audit,
  retire: createRetire({ db: store.db, redis, keys, bus, audit }),
});

const needId = () => {
  if (!arg || !DEVICE_ID.test(arg)) throw new Error("a 22-character device ID is required");
  return arg;
};

let code = 0;
try {
  switch (cmd) {
    case "block": {
      const i = rest.indexOf("--reason");
      const reason = (i >= 0 ? rest.slice(i + 1).join(" ") : rest.join(" ")) || "manual";
      console.error((await admin.block(needId(), reason)) ? "blocked" : "no such device");
      break;
    }
    case "unblock":
      console.error((await admin.unblock(needId())) ? "unblocked" : "no such device");
      break;
    case "retire":
      await admin.retire(needId());
      console.error("retired");
      break;
    case "stats":
      console.error(JSON.stringify(await admin.stats(), null, 2));
      break;
    case "lab":
      if (arg !== "on" && arg !== "off") throw new Error("lab on | lab off");
      await admin.lab(arg === "on");
      console.error(`Security Lab ${arg}`);
      break;
    case "retention":
      await admin.retention();
      console.error("retention applied");
      break;
    default:
      console.error(USAGE);
      code = 2;
  }
} catch (e) {
  console.error((e as Error).message);
  code = 1;
} finally {
  await bus.close();
  redis.disconnect();
  await store.close();
}
process.exit(code);
