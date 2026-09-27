// A worker thread that holds idle sockets (spec 21.4: `worker_threads`). The bulk of the sockets live here, so
// the main thread's event loop stays free and its check latencies measure the relay, not the load generator.
// Messages in: { grow: { count, perSec } } and { stop: true }. Messages out: { ready, logins, total } every 500 ms.
import { parentPort, workerData } from "node:worker_threads";
import type { Endpoint } from "@pehchaan/canary/client";
import { Fleet } from "./fleet";

const fleet = new Fleet(workerData as Endpoint);
const report = setInterval(
  () => parentPort?.postMessage({ ready: fleet.ready, logins: fleet.logins, total: fleet.sessions.length }),
  500,
);

parentPort?.on("message", (m: { grow?: { count: number; perSec: number }; stop?: true }) => {
  if (m.grow) void fleet.grow(m.grow.count, m.grow.perSec);
  if (m.stop) {
    clearInterval(report);
    fleet.stop();
    // Let the close frames go out, then end the thread.
    setTimeout(() => process.exit(0), 500);
  }
});
