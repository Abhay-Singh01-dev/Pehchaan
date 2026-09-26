// The on-device database (IndexedDB via Dexie). All family data lives here, never in
// localStorage (spec B3, B16). One database per simulated device: pehchaan-<name>.
import Dexie, { type Table } from "dexie";
import { device } from "@/app/device";
import type {
  Decision,
  FamilyAlert,
  FamilyMember,
  HistoryEvent,
  LabAttackRecord,
  Profile,
  SignedAnswer,
  VerdictResult,
  VerifyRequest,
} from "@/services/types";

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface ProfileRow extends Profile {
  id: "me";
}

/** A check this phone started (Maa's side). */
export interface OutgoingRecord {
  requestId: string;
  /** Absent for "Someone else" (UNKNOWN_PERSON: no network call). */
  request?: VerifyRequest;
  memberId?: string;
  memberDeviceId?: string;
  memberLabel: string;
  status: "pending" | "done" | "cancelled";
  result?: VerdictResult;
  createdAt: number;
  /** E2: labels of family members the G1 alert went to. */
  alertedLabels?: string[];
  alertStatus?: "sending" | "sent" | "failed" | "none";
  /** E3: labels of family members asked to reach the person (G2). */
  checkOnSentTo?: string[];
}

/** A request this phone was asked to answer (Arjun's side). */
export interface IncomingRecord {
  requestId: string;
  request: VerifyRequest;
  status: "pending" | "answered" | "expired";
  decision?: Decision;
  answer?: SignedAnswer;
  words?: [string, string];
  answeredAt?: number;
  createdAt: number;
}

export interface UsedNonceRow {
  nonce: string;
  at: number;
}

export class PehchaanDB extends Dexie {
  meta!: Table<MetaRow, string>;
  profile!: Table<ProfileRow, string>;
  family!: Table<FamilyMember, string>;
  history!: Table<HistoryEvent, string>;
  alerts!: Table<FamilyAlert, string>;
  outgoing!: Table<OutgoingRecord, string>;
  incoming!: Table<IncomingRecord, string>;
  usedNonces!: Table<UsedNonceRow, string>;
  labAttacks!: Table<LabAttackRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      meta: "key",
      profile: "id",
      family: "id, deviceId, addedAt",
      history: "id, at, kind, memberDeviceId, requestId",
      alerts: "id, createdAt, read",
      outgoing: "requestId, createdAt, status",
      incoming: "requestId, createdAt, status",
      usedNonces: "nonce, at",
      labAttacks: "id, at",
    });
  }
}

export const db = new PehchaanDB(device.dbName);
