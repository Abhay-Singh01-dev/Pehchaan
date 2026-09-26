// Picks the simulated or real implementation of each service by flag (frontend spec B3, backend FC-1):
//   SIM_RELAY → SimRelay (BroadcastChannel) or RealRelay (the WebSocket relay)
//   SIM_KEY → SimKey (software key behind the simulated unlock sheet) or RealKey (the phone's passkey)
//   SIM_VERIFIER → SimVerifier or RealVerifier: the same 7 checks, expecting this page's address or the
//                  configured one (D-008)
// Every combination works (APP-01). Screens import `services` from here and never know which they got.
import { flags } from "@/app/flags";
import { db } from "@/store/db";
import { getMeta, setMeta } from "@/store/meta";
import { getProfile } from "@/store/profile";
import { getMemberByDeviceId } from "@/store/family";
import type {
  AutoAnswerMode,
  GuardService,
  KeyOutcome,
  LabService,
  RelayService,
  Services,
  SimControls,
} from "./types";
import { createCardService } from "./card";
import { createRequestFactory } from "./requests";
import { ensureIdentity, identity, myGrant, rotateLocalGrant } from "./identity";
import { createSimKey } from "./sim/SimKey";
import { createSimVerifier } from "./sim/SimVerifier";
import { createAutoResponder } from "./sim/autoAnswer";
import { SimRelay } from "./sim/SimRelay";
import { createRealKey } from "./real/RealKey";
import { createRealVerifier } from "./real/RealVerifier";
import { RealRelay } from "./real/relay/RealRelay";

let myDeviceId: string | null = null;
/** Set once at boot (app/bootstrap.ts), so the card service can spot "own code". */
export function setMyDeviceId(id: string) {
  myDeviceId = id;
}

const getAutoAnswer = async () => (await getMeta<AutoAnswerMode>("sim:autoAnswer")) ?? "off";
const getKeyOutcome = async () => (await getMeta<KeyOutcome>("sim:keyOutcome")) ?? "success";
const setKeyOutcome = (o: KeyOutcome) => setMeta("sim:keyOutcome", o);

// The Lab and Call Guard are laptop pages, loaded lazily with their own chunks. The *promise* is cached, so
// concurrent callers (React StrictMode's double effects) always share one instance: two Labs on the same channel
// would forward messages twice.
let labLoading: Promise<LabService> | null = null;
let guardLoading: Promise<GuardService> | null = null;

export function loadLab(): Promise<LabService> {
  labLoading ??= flags.SIM_RELAY
    ? import("./sim/SimLab").then(({ SimLab }) => new SimLab(db))
    : import("./real/RealLab").then(({ RealLab }) => new RealLab(services.relay as RealRelay, db));
  return labLoading;
}

/** Call Guard's speech and keyword engine is the same in every build; its prompts travel through the relay. */
export function loadGuard(): Promise<GuardService> {
  guardLoading ??= import("./sim/SimGuard").then(({ SimGuard }) => new SimGuard());
  return guardLoading;
}

function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get() {
      throw new Error(`${name} is loaded lazily: use load${name}() instead`);
    },
  });
}

async function simRevoked(): Promise<string[]> {
  return (await getMeta<string[]>("sim:revoked")) ?? [];
}

function createRelay(): RelayService {
  if (flags.SIM_RELAY) {
    return new SimRelay({
      getAutoAnswer,
      autoRespond: createAutoResponder(db),
      myKeys: () => {
        // Messages are only sent after boot, which establishes the identity.
        const id = identity();
        return { devicePub: id.devicePub, encPub: id.encPub };
      },
      isRevoked: async (d) => (await simRevoked()).includes(d),
      setRevoked: async (d, on) => {
        const list = new Set(await simRevoked());
        if (on) list.add(d);
        else list.delete(d);
        await setMeta("sim:revoked", [...list]);
      },
      revokedList: simRevoked,
      rotateGrant: async () => myGrant(await rotateLocalGrant()),
    });
  }
  return new RealRelay({
    db,
    identity: () => ensureIdentity(),
    lookupMember: getMemberByDeviceId,
    rotateLocalGrant,
  });
}

const relay = createRelay();

export const services: Services = {
  key: flags.SIM_KEY
    ? createSimKey({ db, getOutcome: getKeyOutcome, setOutcome: setKeyOutcome })
    : createRealKey({ getProfile }),
  relay,
  verifier: flags.SIM_VERIFIER ? createSimVerifier(db) : createRealVerifier(db),
  card: createCardService(() => myDeviceId),
  requests: createRequestFactory(),
  lab: unavailable<LabService>("Lab"),
  guard: unavailable<GuardService>("Guard"),
};

/** Simulation panel controls; null when nothing is simulated. */
export const simControls: SimControls | null = flags.SIMULATION
  ? {
      setAutoAnswer: (mode) => setMeta("sim:autoAnswer", mode),
      getAutoAnswer,
      forceConnection: (state) => (relay instanceof SimRelay ? relay.force(state) : undefined),
      forcedConnection: () => (relay instanceof SimRelay ? relay.forcedState() : null),
      setKeyOutcome,
      getKeyOutcome,
    }
  : null;
