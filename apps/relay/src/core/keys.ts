// The Valkey keyspace (spec 15.1), in one place. Every key and channel carries KEY_PREFIX (empty in
// production; one per test file, D-018). Keys that one Lua script touches together share a hash tag
// ({d:<deviceId>}), so moving to Redis Cluster needs no key changes.
export type Keys = ReturnType<typeof createKeys>;

export function createKeys(prefix: string) {
  const p = prefix;
  return {
    prefix: p,
    /** Refreshed every 10 s with a 30 s TTL; if it's gone, the gateway is dead (8.2). */
    gatewayAlive: (gw: string) => `${p}gw:${gw}:alive`,
    /** Set of gateway IDs holding a socket for this device (8.2). */
    route: (deviceId: string) => `${p}rt:${deviceId}`,
    inboxIndex: (deviceId: string) => `${p}{d:${deviceId}}:ib`,
    inboxFrame: (deviceId: string, msgId: string) => `${p}{d:${deviceId}}:m:${msgId}`,
    request: (requestId: string) => `${p}rq:${requestId}`,
    openRequests: (deviceId: string) => `${p}oq:${deviceId}`,
    dedupe: (fromDeviceId: string, msgId: string) => `${p}dd:${fromDeviceId}:${msgId}`,
    rate: (scope: string, key: string) => `${p}rl:${scope}:${key}`,
    bindingCache: (target: string) => `${p}cb:${target}`,
    grantCache: (target: string) => `${p}cg:${target}`,
    pushCache: (deviceId: string) => `${p}ps:${deviceId}`,
    deviceCache: (deviceId: string) => `${p}dv:${deviceId}`,
    labSession: (sessionId: string) => `${p}lab:session:${sessionId}`,
    labOptin: (deviceId: string) => `${p}lab:optin:${deviceId}`,
    labArmed: () => `${p}lab:armed`,
    labHeld: (heldId: string) => `${p}lab:held:${heldId}`,
    labSwitch: () => `${p}cfg:lab`,
    labSince: () => `${p}lab:since`,
    /** Sorted sets scored by expiry: Lab page sessions, and phones opted in (14.1 layers 2 and 3). */
    labPages: () => `${p}lab:pages`,
    labOptins: () => `${p}lab:optins`,
    /** A request the Lab tampered with, until the asker reports its verdict (14.4). */
    labTampered: (requestId: string) => `${p}lab:tampered:${requestId}`,
    /** Abuse-signal counters (16.8). */
    abuse: (kind: string, deviceId: string) => `${p}ab:${kind}:${deviceId}`,
    /** Pub/sub channels. */
    gatewayChannel: (gw: string) => `${p}gw:${gw}`,
    labChannel: () => `${p}lab:events`,
    adminChannel: () => `${p}admin:events`,
  };
}
