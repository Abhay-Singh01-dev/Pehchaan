// Family alerts received on this phone (G1 impersonation, G2 "check on").
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import type { FamilyAlert } from "@/services/types";

export async function saveAlert(alert: FamilyAlert): Promise<void> {
  await db.alerts.put(alert);
}

export async function markAlertRead(id: string): Promise<void> {
  await db.alerts.update(id, { read: true });
}

export async function markAllAlertsRead(): Promise<void> {
  await db.alerts.toCollection().modify({ read: true });
}

export async function resolveAlert(id: string): Promise<void> {
  await db.alerts.update(id, { resolved: true, read: true });
}

export function useAlerts(): FamilyAlert[] | undefined {
  return useLiveQuery(() => db.alerts.orderBy("createdAt").reverse().toArray(), []);
}

export function useUnreadAlertCount(): number {
  return useLiveQuery(() => db.alerts.filter((a) => !a.read).count(), []) ?? 0;
}
