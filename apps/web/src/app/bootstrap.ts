// Boot sequence: seed simulation devices, establish this device's id, connect the relay.
import { services, setMyDeviceId } from "@/services";
import { getMeta, setMeta } from "@/store/meta";
import { device, tidyDeviceParam } from "./device";
import { useSession } from "./session";

let booting: Promise<void> | null = null;

export function bootstrap(): Promise<void> {
  booting ??= (async () => {
    // Seed data exists only for named simulation devices; load it only for them.
    if (device.simName) {
      try {
        const { seedIfNeeded } = await import("@/store/seed");
        await seedIfNeeded(device.simName);
      } catch (e) {
        console.warn("Seeding skipped", e);
      }
    }
    let deviceId = device.fixedDeviceId ?? (await getMeta<string>("deviceId")) ?? null;
    if (!deviceId) {
      deviceId = services.requests.randomId("dev");
      await setMeta("deviceId", deviceId);
    }
    setMyDeviceId(deviceId);
    useSession.setState({ deviceId, ready: true });
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
  return () => {
    offState();
    offPresence();
    offPeers();
  };
}
