// Call Guard's saved phones (backend spec 13.2, FC-22). The Guard page is its own device: it pairs with a parent's
// phone by that phone's family card (scanned or pasted), after comparing the four safety words, and keeps what a
// sealed prompt needs. Stored on this laptop only.
import { useLiveQuery } from "dexie-react-hooks";
import type { FamilyCard, RecipientCard } from "@/services/types";
import { getMeta, setMeta } from "./meta";

export interface GuardTarget extends RecipientCard {
  name: string;
  safetyWords: FamilyCard["safetyWords"];
  addedAt: number;
}

export async function listGuardTargets(): Promise<GuardTarget[]> {
  return (await getMeta<GuardTarget[]>("guard:targets")) ?? [];
}

/** Saves (or refreshes) the phone this card belongs to. */
export async function addGuardTarget(card: FamilyCard, now = Date.now()): Promise<GuardTarget> {
  const target: GuardTarget = {
    deviceId: card.deviceId,
    grant: card.grant,
    encPub: card.encPub,
    devicePub: card.devicePub,
    name: card.name,
    safetyWords: card.safetyWords,
    addedAt: now,
  };
  const others = (await listGuardTargets()).filter((t) => t.deviceId !== card.deviceId);
  await setMeta("guard:targets", [...others, target]);
  return target;
}

export async function removeGuardTarget(deviceId: string): Promise<void> {
  await setMeta(
    "guard:targets",
    (await listGuardTargets()).filter((t) => t.deviceId !== deviceId),
  );
}

export function useGuardTargets(): GuardTarget[] | undefined {
  return useLiveQuery(listGuardTargets, []);
}
