// Boot sequence (backend spec FC-2, 10.9): establish this device's identity (keys and grant, created on the very
// first launch), seed simulation devices, prune old used nonces, then connect the relay.
import { services, setMyDeviceId } from "@/services";
import { ensureIdentity } from "@/services/identity";
import { device, tidyDeviceParam } from "./device";
import { push } from "./push";
import { useSession } from "./session";
import { pruneUsedNonces } from "./verification";

let booting: Promise<void> | null = null;

export function bootstrap(): Promise<void> {
  booting ??= (async () => {
    // Seed data (and fixed keys) exist only for named simulation devices; load them only for them.
    const seed = device.simName ? await import("@/store/seed").catch(() => null) : null;
    const id = await ensureIdentity(seed ? () => seed.seedIdentity(device.simName) : undefined);
    if (seed) {
      try {
        await seed.seedIfNeeded(device.simName);
      } catch (e) {
        console.warn("Seeding skipped", e);
      }
    }
    await pruneUsedNonces().catch(() => {});
    setMyDeviceId(id.deviceId);
    useSession.setState({ deviceId: id.deviceId, ready: true });
    tidyDeviceParam();
  })();
  return booting;
}

/** Connects the family app to the relay and mirrors connection state into the session. */
export function connectRelay() {
  const { deviceId } = useSession.getState();
  if (!deviceId) return () => {};
  services.relay.connect(deviceId);
  const offState = services.relay.onState((connection) => useSession.setState({ connection }));
  const offPresence = services.relay.onPresence((reachable) => useSession.setState({ reachable }));
  const offPeers = services.relay.onPeers((peers) => useSession.setState({ peers }));
  const offUpdate = services.relay.onUpdateRequired(() => useSession.setState({ updateRequired: true }));
  const offInfo = services.relay.onInfo((relayInfo) => {
    useSession.setState({ relayInfo });
    // After each login: keep the push subscription working (expired, missing, a new VAPID key; 11.2, 11.9).
    void push.sync(relayInfo);
  });
  return () => {
    offState();
    offPresence();
    offPeers();
    offUpdate();
    offInfo();
  };
}
