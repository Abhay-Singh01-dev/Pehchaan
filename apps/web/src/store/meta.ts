// Small key/value settings that aren't part of the profile (install dismissed, setup step,
// simulation options, Lab counters…). Stored in IndexedDB like everything else.
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";

export type MetaKey =
  | "deviceId"
  | "prefs"
  | "installDismissed"
  | "setupStep"
  | "setupRole"
  | "sim:autoAnswer"
  | "sim:keyOutcome"
  | "sim:lastYes"
  | "sim:revoked"
  | "pushEnabled"
  | "vapidKeyId"
  | "guard:targets"
  | "relay:contactOps"
  | "grant:rotatePending"
  | "diagnosticsUnlocked"
  | "lab:since"
  | "lab:lastYes"
  | "lab:joinedUntil"
  | "lab:counterBase"
  | "lastVerdictRequestId"
  | "seeded";

export async function getMeta<T>(key: MetaKey): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: MetaKey, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function deleteMeta(key: MetaKey): Promise<void> {
  await db.meta.delete(key);
}

/** Live value; `undefined` while loading, `null` when unset. */
export function useMeta<T>(key: MetaKey): T | null | undefined {
  return useLiveQuery(async () => {
    const row = await db.meta.get(key);
    return row ? (row.value as T) : null;
  }, [key]);
}
