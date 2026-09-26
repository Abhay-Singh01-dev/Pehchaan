// This device's identity (backend spec 5.1, 5.2, 6.4, FC-2): created at first launch, before any screen needs
// the relay, and never sent anywhere except as public keys.
//   - device signing key   ECDSA P-256, non-extractable: logs in to the relay, signs every envelope
//   - device encryption key ECDH P-256, non-extractable: opens envelopes sealed to this device
//   - contact grant         8-byte ID + 16-byte secret: lets people who hold my card contact me
//   - deviceId = base64url(SHA-256(devicePubRaw)).slice(0, 22): self-certifying
import { b64url, b64urlDecode, sha256 } from "@pehchaan/crypto/bytes";
import { deviceIdFrom } from "@pehchaan/crypto/device-auth";
import { db, type IdentityRow } from "@/store/db";

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

let cached: IdentityRow | null = null;
let creating: Promise<IdentityRow> | null = null;

const rawPub = async (k: CryptoKey) => b64url(new Uint8Array(await crypto.subtle.exportKey("raw", k)));
const randomB64 = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function newIdentity(): Promise<IdentityRow> {
  // Private keys are non-extractable: even this app's own code can't read them out. Public keys always can.
  const signKey = await crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]);
  const encKey = await crypto.subtle.generateKey(ECDH, false, ["deriveBits"]);
  const devicePub = await rawPub(signKey.publicKey);
  return {
    id: "me",
    deviceId: await deviceIdFrom(b64urlDecode(devicePub)),
    signKey,
    encKey,
    devicePub,
    encPub: await rawPub(encKey.publicKey),
    grantId: randomB64(8),
    grantSecret: randomB64(16),
    createdAt: Date.now(),
  };
}

/** The identity, creating it the first time (or taking a simulation seed's fixed one). */
export function ensureIdentity(seeded?: () => Promise<IdentityRow | null>): Promise<IdentityRow> {
  if (cached) return Promise.resolve(cached);
  creating ??= (async () => {
    const existing = await db.identity.get("me");
    if (existing) return existing;
    // Keys are made OUTSIDE the transaction: IndexedDB commits a transaction as soon as it has nothing to do,
    // so awaiting WebCrypto inside one fails. The transaction then only decides which identity is kept: if
    // another tab stored one meanwhile, that one wins and these keys are discarded.
    const candidate = (seeded ? await seeded() : null) ?? (await newIdentity());
    return db.transaction("rw", db.identity, async () => {
      const stored = await db.identity.get("me");
      if (stored) return stored;
      await db.identity.put(candidate);
      return candidate;
    });
  })()
    .then((row) => (cached = row))
    .finally(() => (creating = null));
  return creating;
}

/** The identity after boot (throws before). */
export function identity(): IdentityRow {
  if (!cached) throw new Error("Device identity not ready");
  return cached;
}

/** For tests and "Delete all data": forget the cached identity. */
export function resetIdentityCache(): void {
  cached = null;
}

/** The grant string on my card: "<grantId>.<secret>". */
export const myGrant = (row: IdentityRow = identity()) => `${row.grantId}.${row.grantSecret}`;

/** What the relay stores for my grant: SHA-256 of the secret's bytes (D-028). */
export async function grantHash(secret: string): Promise<string> {
  return b64url(await sha256(b64urlDecode(secret)));
}

/** "Reset my code" (6.4): a new grant. Old cards stop working for NEW people; existing bindings stay. */
export async function rotateLocalGrant(): Promise<IdentityRow> {
  const row = { ...identity(), grantId: randomB64(8), grantSecret: randomB64(16) };
  await db.identity.put(row);
  cached = row;
  return row;
}

export type StorageState = "protected" | "may_be_cleared" | "unsupported";

/** Asks the browser not to clear this app's storage (5.4, FC-11). Installed PWAs usually get it. */
export async function persistStorage(): Promise<StorageState> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return "unsupported";
  try {
    if (await navigator.storage.persisted()) return "protected";
    return (await navigator.storage.persist()) ? "protected" : "may_be_cleared";
  } catch {
    return "unsupported";
  }
}

export async function storageState(): Promise<StorageState> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return "unsupported";
  try {
    return (await navigator.storage.persisted()) ? "protected" : "may_be_cleared";
  } catch {
    return "unsupported";
  }
}
