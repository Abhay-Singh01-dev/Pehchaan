// The on-device database (IndexedDB via Dexie). All family data lives here, never in localStorage
// (frontend spec B3, B16). One database per simulated device: pehchaan-<name>.
//
// Version 2 (backend spec FC-2, 8.4, 10.9, 11.5): the device identity (signing and encryption keys, kept as
// non-extractable CryptoKey objects), the answer outbox, the push inbox the service worker writes, and the
// used-nonce store with its request IDs. Cards became v2 (device keys + grant), so v1 data from before the
// real backend is cleared on upgrade (D-035).
import Dexie, { type Table } from "dexie";
import { device } from "@/app/device";
import type {
  Decision,
  FamilyAlert,
  FamilyMember,
  HistoryEvent,
  LabAttackRecord,
  Profile,
  ReceiptState,
  VerdictResult,
  VerifyRequest,
  WireAnswer,
} from "@/services/types";

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface ProfileRow extends Profile {
  id: "me";
}

/** This device's identity (5.1): created at first launch, never leaves the device. */
export interface IdentityRow {
  id: "me";
  deviceId: string;
  /** ECDSA P-256; the private key is non-extractable. Logs in to the relay and signs envelopes. */
  signKey: CryptoKeyPair;
  /** ECDH P-256; the private key is non-extractable. Opens envelopes sealed to this device. */
  encKey: CryptoKeyPair;
  devicePub: string;
  encPub: string;
  /** The contact grant on my card: "<grantId>.<secret>" (6.4). */
  grantId: string;
  grantSecret: string;
  createdAt: number;
}

/** A simulated passkey (SIM_KEY): a software P-256 key behind the simulated unlock sheet (D-008). */
export interface SimKeyRow {
  id: "me";
  credId: string;
  publicKey: string;
  privateKey: CryptoKey;
}

/** Per-recipient delivery of a family alert (13.1): receipts drive "Family alerted: {names}". */
export interface AlertDelivery {
  deviceId: string;
  label: string;
  msgId: string;
  state: ReceiptState | "sending";
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
  /** FC-12: what the receipts said so far. */
  delivery?: "sent" | "pushed" | "queued" | "delivered" | "seen";
  /** E2 (G1) and E3 (G2) alerts, one entry per family member. */
  alerts?: AlertDelivery[];
  checkOnAlerts?: AlertDelivery[];
  alertStatus?: "sending" | "sent" | "failed" | "none";
  /** 10.9: the request's nonce is in the used-nonce store. */
  nonceMarked?: boolean;
  /** 10.7: an answer that arrived after the timer has been handled (only the first one counts). */
  lateHandled?: boolean;
}

/** A request this phone was asked to answer (Arjun's side). */
export interface IncomingRecord {
  requestId: string;
  request: VerifyRequest;
  status: "pending" | "answered" | "expired" | "cancelled";
  /** Why it stopped (FC-15): the asker stopped waiting, or it was answered on another device. */
  cancelReason?: "asker_cancelled" | "answered_elsewhere" | "expired";
  /** Relay-authenticated sender, and the keys the answer goes back to. */
  envFrom: string;
  senderDevicePub: string;
  senderEncPub: string;
  /** F1's countdown (FC-14, 8.7): the relay's time left, counted on THIS phone's clock. */
  ttlMs: number;
  receivedAt: number;
  localDeadline: number;
  decision?: Decision;
  answer?: WireAnswer;
  words?: [string, string];
  answeredAt?: number;
  createdAt: number;
}

/** 10.9: kept 30 days, pruned at start. */
export interface UsedNonceRow {
  nonce: string;
  requestId: string;
  usedAt: number;
}

/** 8.4: answers are re-sent with the SAME id until the relay confirms them, even across a reload. */
export interface OutboxRow {
  id: string;
  kind: string;
  frame: string;
  expiresAt: number;
  createdAt: number;
}

/** 11.5: envelopes the service worker received by push while the app was closed. */
export interface PushInboxRow {
  id: string;
  frame: unknown;
  at: number;
}

export class PehchaanDB extends Dexie {
  meta!: Table<MetaRow, string>;
  profile!: Table<ProfileRow, string>;
  identity!: Table<IdentityRow, string>;
  simKey!: Table<SimKeyRow, string>;
  family!: Table<FamilyMember, string>;
  history!: Table<HistoryEvent, string>;
  alerts!: Table<FamilyAlert, string>;
  outgoing!: Table<OutgoingRecord, string>;
  incoming!: Table<IncomingRecord, string>;
  usedNonces!: Table<UsedNonceRow, string>;
  outbox!: Table<OutboxRow, string>;
  pushInbox!: Table<PushInboxRow, string>;
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
    this.version(2)
      .stores({
        identity: "id",
        simKey: "id",
        usedNonces: "nonce, usedAt, requestId",
        outbox: "id, expiresAt",
        pushInbox: "id, at",
      })
      .upgrade(async (tx) => {
        // v1 cards had no device keys or grant and can't reach the real relay: start clean (D-035).
        for (const t of ["meta", "profile", "family", "history", "alerts", "outgoing", "incoming", "usedNonces"]) {
          await tx.table(t).clear();
        }
      });
  }
}

export const db = new PehchaanDB(device.dbName);
