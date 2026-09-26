// Outgoing checks (this phone asked) and incoming requests (this phone was asked).
import { useLiveQuery } from "dexie-react-hooks";
import { db, type IncomingRecord, type OutgoingRecord } from "./db";

// ─── Outgoing ────────────────────────────────────────────────────────────────

export async function saveOutgoing(r: OutgoingRecord): Promise<void> {
  await db.outgoing.put(r);
}

export async function getOutgoing(requestId: string): Promise<OutgoingRecord | undefined> {
  return db.outgoing.get(requestId);
}

export async function updateOutgoing(requestId: string, patch: Partial<OutgoingRecord>): Promise<void> {
  await db.outgoing.update(requestId, patch);
}

export function useOutgoing(requestId: string | undefined): OutgoingRecord | null | undefined {
  return useLiveQuery(async () => (requestId ? ((await db.outgoing.get(requestId)) ?? null) : null), [requestId]);
}

/** The most recent finished check within `withinMs` (Home "Check again" chip). */
export function useRecentCheck(withinMs = 10 * 60_000): OutgoingRecord | null | undefined {
  return useLiveQuery(async () => {
    const last = await db.outgoing.orderBy("createdAt").reverse().first();
    if (!last || !last.request || last.status !== "done") return null;
    return Date.now() - last.createdAt <= withinMs ? last : null;
  }, [withinMs]);
}

export function useLastResult(): OutgoingRecord | null | undefined {
  return useLiveQuery(async () => {
    const rows = await db.outgoing.orderBy("createdAt").reverse().toArray();
    return rows.find((r) => r.result) ?? null;
  }, []);
}

// ─── Incoming ────────────────────────────────────────────────────────────────

export async function saveIncoming(r: IncomingRecord): Promise<void> {
  await db.incoming.put(r);
}

export async function getIncoming(requestId: string): Promise<IncomingRecord | undefined> {
  return db.incoming.get(requestId);
}

export async function updateIncoming(requestId: string, patch: Partial<IncomingRecord>): Promise<void> {
  await db.incoming.update(requestId, patch);
}

/** Pending, unexpired incoming requests, oldest first (F1 handles them one at a time). */
export async function pendingIncoming(now = Date.now()): Promise<IncomingRecord[]> {
  const rows = await db.incoming.where("status").equals("pending").toArray();
  return rows.filter((r) => r.request.expiresAt > now).sort((a, b) => a.createdAt - b.createdAt);
}

export function useIncoming(requestId: string | undefined): IncomingRecord | null | undefined {
  return useLiveQuery(async () => (requestId ? ((await db.incoming.get(requestId)) ?? null) : null), [requestId]);
}

export function usePendingIncoming(): IncomingRecord[] | undefined {
  return useLiveQuery(() => pendingIncoming(), []);
}
