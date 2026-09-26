// Picks the simulated or real service implementations by flag (spec B3).
// Screens import `services` from here and never know which one they got.
//
// Real implementations are never constructed while SIMULATION is true.
import { flags } from "@/app/flags";
import { db } from "@/store/db";
import { getMeta, setMeta } from "@/store/meta";
import { getProfile } from "@/store/profile";
import type { AutoAnswerMode, KeyOutcome, LabService, GuardService, Services, SimControls } from "./types";
import { createCardService } from "./card";
import { createRequestFactory } from "./requests";
import { createSimKey } from "./sim/SimKey";
import { createSimVerifier } from "./sim/SimVerifier";
import { createAutoResponder } from "./sim/autoAnswer";
import { SimRelay } from "./sim/SimRelay";
import { RealRelay } from "./real/RealRelay";
import { RealKey } from "./real/RealKey";
import { RealVerifier } from "./real/RealVerifier";

let myDeviceId: string | null = null;
/** Set once at boot (app/bootstrap.ts), so the card service can spot "own code". */
export function setMyDeviceId(id: string) {
  myDeviceId = id;
}

const getAutoAnswer = async () => (await getMeta<AutoAnswerMode>("sim:autoAnswer")) ?? "off";
const getKeyOutcome = async () => (await getMeta<KeyOutcome>("sim:keyOutcome")) ?? "success";

// The Lab and Call Guard are laptop pages, loaded lazily with their own chunks. The *promise*
// is cached, so concurrent callers (e.g. React StrictMode's double effects) always share one
// instance: two Labs on the same channel would forward messages twice.
let labLoading: Promise<LabService> | null = null;
let guardLoading: Promise<GuardService> | null = null;

export function loadLab(): Promise<LabService> {
  labLoading ??= flags.SIMULATION
    ? import("./sim/SimLab").then(({ SimLab }) => new SimLab(db))
    : import("./real/RealLab").then(({ RealLab }) => new RealLab());
  return labLoading;
}

export function loadGuard(): Promise<GuardService> {
  guardLoading ??= flags.SIMULATION
    ? import("./sim/SimGuard").then(({ SimGuard }) => new SimGuard())
    : import("./real/RealGuard").then(({ RealGuard }) => new RealGuard());
  return guardLoading;
}

function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get() {
      throw new Error(`${name} is loaded lazily: use load${name}() instead`);
    },
  });
}

function createSimServices(): { services: Services; controls: SimControls; relay: SimRelay } {
  const relay = new SimRelay({ getAutoAnswer, autoRespond: createAutoResponder(db) });
  const controls: SimControls = {
    setAutoAnswer: (mode) => setMeta("sim:autoAnswer", mode),
    getAutoAnswer,
    forceConnection: (state) => relay.force(state),
    forcedConnection: () => relay.forcedState(),
    setKeyOutcome: (o) => setMeta("sim:keyOutcome", o),
    getKeyOutcome,
  };
  const services: Services = {
    key: createSimKey({ getProfile, getOutcome: getKeyOutcome, setOutcome: (o) => setMeta("sim:keyOutcome", o) }),
    relay,
    verifier: createSimVerifier(db),
    card: createCardService(() => myDeviceId),
    requests: createRequestFactory(),
    lab: unavailable<LabService>("Lab"),
    guard: unavailable<GuardService>("Guard"),
  };
  return { services, controls, relay };
}

function createRealServices(): Services {
  return {
    key: new RealKey(),
    relay: new RealRelay(),
    verifier: new RealVerifier(),
    card: createCardService(() => myDeviceId),
    requests: createRequestFactory(),
    lab: unavailable<LabService>("Lab"),
    guard: unavailable<GuardService>("Guard"),
  };
}

const built = flags.SIMULATION ? createSimServices() : null;

export const services: Services = built ? built.services : createRealServices();

/** Simulation panel controls; null outside simulation mode. */
export const simControls: SimControls | null = built ? built.controls : null;
