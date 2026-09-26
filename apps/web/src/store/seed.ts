// Seed data for simulation devices (spec B4, "Seed data").
//
// Created only when the simulation device name is maa or arjun (and, as a convenience for the
// Part D walkthrough, priya) and the database is empty. Device ids and keys match across the
// seeds so the tabs can reach and verify each other.
import { db } from "./db";
import { getMeta, setMeta } from "./meta";
import { DEFAULT_PREFS } from "./profile";
import type { CheckResult, FamilyMember, HistoryEvent, Profile, SafetyWordsT } from "@/services/types";

const DAY = 86_400_000;

export const SEED = {
  maa: {
    deviceId: "sim-maa",
    name: "Sunita Sharma",
    phone: "+91 98xxx xxx21",
    color: "rose" as const,
    safetyWords: ["JASMINE", "COMPASS", "MOON", "SILK"] as SafetyWordsT,
  },
  arjun: {
    deviceId: "sim-arjun",
    name: "Arjun Sharma",
    phone: "+91 98xxx xxx10",
    color: "indigo" as const,
    keyId: "key_arjun_5f2c9a71d0",
    publicKey: "pk_sim_BPx3aJ0r9Qv2mW8kLt6yZs1eHn4cUd7fGi0oRp5wXb2",
    safetyWords: ["TIGER", "MANGO", "RIVER", "LAMP"] as SafetyWordsT,
  },
  priya: {
    deviceId: "sim-priya",
    name: "Priya Sharma",
    phone: "+91 98xxx xxx34",
    color: "teal" as const,
    keyId: "key_priya_8b41e6c2f3",
    publicKey: "pk_sim_BKq7tN2vY5pC9hR3mA8zLw6jDs0eFu4gIx1oTb7cWn3",
    safetyWords: ["LOTUS", "CANDLE", "PEARL", "HARBOR"] as SafetyWordsT,
  },
  ramesh: {
    deviceId: "sim-ramesh",
    name: "Ramesh Sharma",
    color: "saffron" as const,
    safetyWords: ["BANYAN", "COPPER", "RAIN", "FLUTE"] as SafetyWordsT,
  },
};

function baseProfile(p: Partial<Profile> & Pick<Profile, "deviceId" | "name" | "color" | "role">): Profile {
  return {
    ...DEFAULT_PREFS,
    lang: "en",
    createdAt: Date.now() - 40 * DAY,
    setupComplete: true,
    ...p,
  };
}

function member(
  id: string,
  s: { deviceId: string; name: string; phone?: string; color: FamilyMember["color"]; keyId?: string; publicKey?: string; safetyWords: SafetyWordsT },
  label: string,
  relation: FamilyMember["relation"],
  addedDaysAgo: number,
): FamilyMember {
  const canBeVerified = Boolean(s.keyId);
  const m: FamilyMember = {
    v: 1,
    id,
    deviceId: s.deviceId,
    name: s.name,
    color: s.color,
    canBeVerified,
    safetyWords: s.safetyWords,
    label,
    relation,
    addedAt: Date.now() - addedDaysAgo * DAY,
    addedBy: "in_person",
  };
  if (s.phone) m.phone = s.phone;
  if (canBeVerified) {
    m.keyId = s.keyId;
    m.publicKey = s.publicKey;
  }
  return m;
}

function passedChecks(name: string, sentSeconds: number): CheckResult[] {
  return [
    { n: 1, key: "fresh", passed: true, params: { n: sentSeconds } },
    { n: 2, key: "key", passed: true, params: { name } },
    { n: 3, key: "exact", passed: true },
    { n: 4, key: "address", passed: true },
    { n: 5, key: "unlocked", passed: true, params: { name } },
    { n: 6, key: "signature", passed: true },
    { n: 7, key: "unused", passed: true },
  ];
}

export async function seedIfNeeded(simName: string | null): Promise<void> {
  if (!simName || !["maa", "arjun", "priya"].includes(simName)) return;
  if (await getMeta<boolean>("seeded")) return;
  if ((await db.profile.count()) > 0 || (await db.family.count()) > 0) return;

  const now = Date.now();

  await db.transaction("rw", [db.profile, db.family, db.history, db.meta], async () => {
    if (simName === "maa") {
      await db.profile.put({
        id: "me",
        ...baseProfile({
          deviceId: SEED.maa.deviceId,
          name: SEED.maa.name,
          phone: SEED.maa.phone,
          color: SEED.maa.color,
          role: "checks_only",
          safetyWords: SEED.maa.safetyWords,
          hindiForm: "f",
        }),
      });
      await db.family.bulkPut([
        member("m_seed_arjun", SEED.arjun, "Arjun", "son", 30),
        member("m_seed_priya", SEED.priya, "Priya", "daughter", 30),
        member("m_seed_ramesh", SEED.ramesh, "Ramesh", "husband", 29),
      ]);
      const history: HistoryEvent[] = [
        {
          id: "h_seed_priya",
          kind: "checked",
          personLabel: "Priya",
          memberDeviceId: SEED.priya.deviceId,
          verdict: "VERIFIED",
          reason: "nothing_yet",
          at: now - 3 * DAY,
          askedAt: now - 3 * DAY - 4200,
          answeredAt: now - 3 * DAY - 300,
          elapsedMs: 3900,
          checks: passedChecks("Priya", 4),
          viewed: true,
        },
        {
          id: "h_seed_arjun",
          kind: "checked",
          personLabel: "Arjun",
          memberDeviceId: SEED.arjun.deviceId,
          verdict: "DENIED",
          reason: "money",
          amountInr: 20000,
          at: now - 12 * DAY,
          askedAt: now - 12 * DAY - 5200,
          answeredAt: now - 12 * DAY - 400,
          elapsedMs: 4800,
          checks: passedChecks("Arjun", 5),
          viewed: true,
        },
      ];
      await db.history.bulkPut(history);
    }

    if (simName === "arjun") {
      await db.profile.put({
        id: "me",
        ...baseProfile({
          deviceId: SEED.arjun.deviceId,
          name: SEED.arjun.name,
          phone: SEED.arjun.phone,
          color: SEED.arjun.color,
          role: "can_be_verified",
          keyId: SEED.arjun.keyId,
          publicKey: SEED.arjun.publicKey,
          safetyWords: SEED.arjun.safetyWords,
          keyCreatedAt: now - 30 * DAY,
          keyKind: "passkey",
          hindiForm: "m",
        }),
      });
      await db.family.bulkPut([
        member("m_seed_maa", SEED.maa, "Maa", "mother", 30),
        member("m_seed_priya", SEED.priya, "Priya", "sister", 30),
      ]);
    }

    if (simName === "priya") {
      await db.profile.put({
        id: "me",
        ...baseProfile({
          deviceId: SEED.priya.deviceId,
          name: SEED.priya.name,
          phone: SEED.priya.phone,
          color: SEED.priya.color,
          role: "can_be_verified",
          keyId: SEED.priya.keyId,
          publicKey: SEED.priya.publicKey,
          safetyWords: SEED.priya.safetyWords,
          keyCreatedAt: now - 30 * DAY,
          keyKind: "passkey",
          hindiForm: "f",
        }),
      });
      await db.family.bulkPut([
        member("m_seed_maa", SEED.maa, "Maa", "mother", 30),
        member("m_seed_arjun", SEED.arjun, "Arjun", "brother", 30),
      ]);
    }

    await setMeta("seeded", true);
    // The builder's preview opens seeded devices straight into the app.
    await setMeta("installDismissed", true);
  });
}

/** Diagnostics → "Load example family": adds the seed family to whoever this device is. */
export async function loadExampleFamily(myDeviceId: string): Promise<number> {
  const candidates: FamilyMember[] = [
    member("m_seed_arjun", SEED.arjun, "Arjun", "son", 1),
    member("m_seed_priya", SEED.priya, "Priya", "daughter", 1),
    member("m_seed_ramesh", SEED.ramesh, "Ramesh", "husband", 1),
    member("m_seed_maa", SEED.maa, "Maa", "mother", 1),
  ].filter((m) => m.deviceId !== myDeviceId);
  let added = 0;
  for (const m of candidates) {
    const exists = await db.family.where("deviceId").equals(m.deviceId).first();
    if (!exists) {
      await db.family.put(m);
      added++;
    }
  }
  return added;
}
