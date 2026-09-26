// Family members this phone knows (added in person by QR, or from a family link).
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { uid } from "@/lib/uid";
import type { FamilyCard, FamilyMember, Relation } from "@/services/types";

export async function listFamily(): Promise<FamilyMember[]> {
  return db.family.orderBy("addedAt").toArray();
}

export async function getMember(id: string): Promise<FamilyMember | undefined> {
  return db.family.get(id);
}

export async function getMemberByDeviceId(deviceId: string): Promise<FamilyMember | undefined> {
  return db.family.where("deviceId").equals(deviceId).first();
}

export async function addMember(
  card: FamilyCard,
  p: { label: string; relation: Relation; addedBy: FamilyMember["addedBy"] },
): Promise<FamilyMember> {
  const existing = await getMemberByDeviceId(card.deviceId);
  const member: FamilyMember = {
    ...card,
    id: existing?.id ?? uid("m"),
    label: p.label.trim().slice(0, 30) || card.name,
    relation: p.relation,
    addedAt: existing?.addedAt ?? Date.now(),
    addedBy: p.addedBy,
  };
  await db.family.put(member);
  return member;
}

export async function updateMember(id: string, patch: Partial<FamilyMember>): Promise<void> {
  await db.family.update(id, patch);
}

export async function removeMember(id: string): Promise<void> {
  await db.family.delete(id);
}

export function useFamily(): FamilyMember[] | undefined {
  return useLiveQuery(listFamily, []);
}

/** `undefined` while loading, `null` when not found. */
export function useMember(id: string | undefined): FamilyMember | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.family.get(id)) ?? null) : null), [id]);
}

/** A sensible default label for someone just added ("Maa" for a mother, and so on). */
export function suggestLabel(name: string, relation: Relation, lang: "en" | "hi"): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  if (relation === "mother") return lang === "hi" ? "माँ" : "Maa";
  if (relation === "father") return lang === "hi" ? "पापा" : "Papa";
  return first;
}
