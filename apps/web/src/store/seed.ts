// Seed data for simulation devices (frontend spec B4, "Seed data").
//
// Created only for the simulation device names maa, arjun and priya (plus ramesh, who is only ever a family
// member), when the database is empty. Each seeded phone has fixed keys (seedKeys.ts), so the tabs can reach and
// verify each other: device IDs, cards and safety words all derive from those keys exactly as on a real phone.
import { putVaultCred } from "@/services/sim/vault";
import type { CheckResult, FamilyMember, HistoryEvent, Profile, SafetyWordsT } from "@/services/types";
import { db, type IdentityRow } from "./db";
import { getMeta, setMeta } from "./meta";
import { DEFAULT_PREFS } from "./profile";
import { SEED_KEYS } from "./seedKeys";

const DAY = 86_400_000;
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

type SeedName = keyof typeof SEED_KEYS;

export const SEED = {
  maa: { name: "Sunita Sharma", phone: "+91 98xxx xxx21", color: "rose" as const },
  arjun: { name: "Arjun Sharma", phone: "+91 98xxx xxx10", color: "indigo" as const },
  priya: { name: "Priya Sharma", phone: "+91 98xxx xxx34", color: "teal" as const },
  ramesh: { name: "Ramesh Sharma", color: "saffron" as const },
} satisfies Record<SeedName, { name: string; phone?: string; color: FamilyMember["color"] }>;

const isSeedName = (n: string | null): n is SeedName => n !== null && n in SEED_KEYS;

const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function keyPair(k: { jwk: JsonWebKey; raw: string }, alg: typeof ECDSA | typeof ECDH): Promise<CryptoKeyPair> {
  const signing = alg.name === "ECDSA";
  return {
    privateKey: await crypto.subtle.importKey("jwk", k.jwk, alg, false, signing ? ["sign"] : ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("raw", fromB64(k.raw), alg, true, signing ? ["verify"] : []),
  };
}

/** The seeded phone's identity (its fixed keys), or null for any other name. */
export async function seedIdentity(simName: string | null): Promise<IdentityRow | null> {
  if (!isSeedName(simName)) return null;
  const s = SEED_KEYS[simName];
  return {
    id: "me",
    deviceId: s.deviceId,
    signKey: await keyPair(s.sign as { jwk: JsonWebKey; raw: string }, ECDSA),
    encKey: await keyPair(s.enc as { jwk: JsonWebKey; raw: string }, ECDH),
    devicePub: s.sign.raw,
    encPub: s.enc.raw,
    grantId: s.grant.id,
    grantSecret: s.grant.secret,
    createdAt: Date.now() - 40 * DAY,
  };
}

function baseProfile(p: Partial<Profile> & Pick<Profile, "deviceId" | "name" | "color" | "role">): Profile {
  return { ...DEFAULT_PREFS, lang: "en", createdAt: Date.now() - 40 * DAY, setupComplete: true, ...p };
}

function member(
  id: string,
  who: SeedName,
  label: string,
  relation: FamilyMember["relation"],
  addedDaysAgo: number,
): FamilyMember {
  const k = SEED_KEYS[who];
  const s = SEED[who];
  const passkey = "passkey" in k ? k.passkey : undefined;
  const m: FamilyMember = {
    v: 2,
    id,
    deviceId: k.deviceId,
    name: s.name,
    color: s.color,
    canBeVerified: Boolean(passkey),
    devicePub: k.sign.raw,
    encPub: k.enc.raw,
    grant: `${k.grant.id}.${k.grant.secret}`,
    createdAt: Date.now() - 40 * DAY,
    safetyWords: [...k.safetyWords] as SafetyWordsT,
    label,
    relation,
    addedAt: Date.now() - addedDaysAgo * DAY,
    addedBy: "in_person",
  };
  if ("phone" in s) m.phone = s.phone;
  if (passkey) Object.assign(m, { keyType: "pk" as const, keyId: passkey.credId, publicKey: passkey.raw });
  return m;
}

function passedChecks(name: string, sentSeconds: number): CheckResult[] {
  return [
    { n: 1, key: "fresh", passed: true, params: { n: sentSeconds } },
    { n: 2, key: "key", passed: true, params: { name } },
    { n: 3, key: "exact", passed: true },
    { n: 4, key: "address", passed: true },
    { n: 5, key: "unlocked", passed: true, params: { name } },
    { n: 6, key: "signature", passed: true, params: { name } },
    { n: 7, key: "unused", passed: true },
  ];
}

/** The simulated passkeys of Arjun and Priya go into the shared vault, so any tab's auto-answer can sign as them. */
async function seedVault() {
  for (const who of ["arjun", "priya"] as const) {
    const pk = SEED_KEYS[who].passkey;
    const pair = await keyPair(pk as { jwk: JsonWebKey; raw: string }, ECDSA);
    await putVaultCred({
      credId: pk.credId,
      deviceId: SEED_KEYS[who].deviceId,
      publicKey: pk.raw,
      privateKey: pair.privateKey,
    });
  }
}

export async function seedIfNeeded(simName: string | null): Promise<void> {
  if (!simName || !["maa", "arjun", "priya"].includes(simName)) return;
  await seedVault();
  if (await getMeta<boolean>("seeded")) return;
  if ((await db.profile.count()) > 0 || (await db.family.count()) > 0) return;
  const now = Date.now();
  const who = simName as "maa" | "arjun" | "priya";
  const k = SEED_KEYS[who];

  const ownPasskey = who === "maa" ? null : SEED_KEYS[who].passkey;
  const simKeyRow = ownPasskey
    ? {
        id: "me" as const,
        credId: ownPasskey.credId,
        publicKey: ownPasskey.raw,
        privateKey: (await keyPair(ownPasskey as { jwk: JsonWebKey; raw: string }, ECDSA)).privateKey,
      }
    : null;

  await db.transaction("rw", [db.profile, db.family, db.history, db.meta, db.simKey], async () => {
    await db.profile.put({
      id: "me",
      ...baseProfile({
        deviceId: k.deviceId,
        name: SEED[who].name,
        phone: SEED[who].phone,
        color: SEED[who].color,
        role: ownPasskey ? "can_be_verified" : "checks_only",
        safetyWords: [...k.safetyWords] as SafetyWordsT,
        hindiForm: who === "arjun" ? "m" : "f",
        ...(ownPasskey
          ? {
              keyId: ownPasskey.credId,
              publicKey: ownPasskey.raw,
              keyCreatedAt: now - 30 * DAY,
              keyKind: "passkey" as const,
            }
          : {}),
      }),
    });
    if (simKeyRow) await db.simKey.put(simKeyRow);

    if (who === "maa") {
      await db.family.bulkPut([
        member("m_seed_arjun", "arjun", "Arjun", "son", 30),
        member("m_seed_priya", "priya", "Priya", "daughter", 30),
        member("m_seed_ramesh", "ramesh", "Ramesh", "husband", 29),
      ]);
      const history: HistoryEvent[] = [
        {
          id: "h_seed_priya",
          kind: "checked",
          personLabel: "Priya",
          memberDeviceId: SEED_KEYS.priya.deviceId,
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
          memberDeviceId: SEED_KEYS.arjun.deviceId,
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
    if (who === "arjun") {
      await db.family.bulkPut([
        member("m_seed_maa", "maa", "Maa", "mother", 30),
        member("m_seed_priya", "priya", "Priya", "sister", 30),
      ]);
    }
    if (who === "priya") {
      await db.family.bulkPut([
        member("m_seed_maa", "maa", "Maa", "mother", 30),
        member("m_seed_arjun", "arjun", "Arjun", "brother", 30),
      ]);
    }
    await setMeta("seeded", true);
    // The builder's preview opens seeded devices straight into the app.
    await setMeta("installDismissed", true);
  });
}

/** Diagnostics → "Load example family": adds the seed family to whoever this device is. */
export async function loadExampleFamily(myDeviceId: string): Promise<number> {
  await seedVault();
  const candidates: FamilyMember[] = [
    member("m_seed_arjun", "arjun", "Arjun", "son", 1),
    member("m_seed_priya", "priya", "Priya", "daughter", 1),
    member("m_seed_ramesh", "ramesh", "Ramesh", "husband", 1),
    member("m_seed_maa", "maa", "Maa", "mother", 1),
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
