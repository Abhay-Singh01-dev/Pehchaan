// History of checks (Maa's side) and answers (Arjun's side).
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { uid } from "@/lib/uid";
import type { HistoryEvent } from "@/services/types";

export async function addHistory(e: Omit<HistoryEvent, "id"> & { id?: string }): Promise<HistoryEvent> {
  const event: HistoryEvent = { ...e, id: e.id ?? uid("h") };
  await db.history.put(event);
  return event;
}

export async function deleteHistory(id: string): Promise<void> {
  await db.history.delete(id);
}

export async function markHistoryViewed(id: string): Promise<void> {
  await db.history.update(id, { viewed: true });
}

export function useHistory(kind?: HistoryEvent["kind"]): HistoryEvent[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.history.orderBy("at").reverse().toArray();
    return kind ? all.filter((e) => e.kind === kind) : all;
  }, [kind]);
}

export function useHistoryEvent(id: string | undefined): HistoryEvent | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.history.get(id)) ?? null) : null), [id]);
}

export function useMemberHistory(deviceId: string | undefined, limit = 5): HistoryEvent[] | undefined {
  return useLiveQuery(async () => {
    if (!deviceId) return [];
    const rows = await db.history.where("memberDeviceId").equals(deviceId).toArray();
    return rows.sort((a, b) => b.at - a.at).slice(0, limit);
  }, [deviceId, limit]);
}
