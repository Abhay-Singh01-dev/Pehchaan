// Pehchaan service contracts and data model (frontend spec B3 + B4, backend spec 22.2).
//
// Screens only ever talk to these interfaces. `services/index.ts` picks the simulated or the real
// implementation of each service by flag (SIM_RELAY, SIM_KEY, SIM_VERIFIER).
//
// Additions beyond the frontend spec are marked "EXTENSION" with the reason.
import type { ReceiptState } from "@pehchaan/protocol";
import type { WireAnswer } from "@pehchaan/crypto";

export type { ReceiptState, WireAnswer };
export type Unsubscribe = () => void;

// ─── B4 · Data model ────────────────────────────────────────────────────────────────

export type Lang = "en" | "hi";
export type Role = "can_be_verified" | "checks_only";
export type AvatarColor = "indigo" | "teal" | "saffron" | "rose" | "plum" | "slate";
export type Relation =
  "son" | "daughter" | "mother" | "father" | "husband" | "wife" | "brother" | "sister" | "grandchild" | "other";
export type AskReason = "money" | "otp" | "bank_details" | "install_app" | "nothing_yet";
export type Decision = "ME" | "NOT_ME";
export type Verdict = "VERIFIED" | "DENIED" | "NO_RESPONSE" | "INVALID" | "UNKNOWN_PERSON";
export type InvalidReason =
  "changed" | "reused" | "wrong_key" | "wrong_app" | "not_unlocked" | "bad_signature" | "expired";
/** 22.2: `late` (a YES after the timer) and `not_allowed` (the person isn't accepting checks from me). */
export type NoResponseReason = "timeout" | "offline" | "relay_unreachable" | "late" | "not_allowed";
export type ConnectionState = "connected" | "reconnecting" | "offline";
export type SafetyWordsT = [string, string, string, string];
export type HindiForm = "m" | "f" | "n";
export type ThemePref = "system" | "light" | "dark";
export type TextSize = "normal" | "large" | "xlarge";
export type PresenceState = "online" | "push" | "offline";

export interface Profile {
  /** Derived from the device signing key (5.2). */
  deviceId: string;
  name: string;
  phone?: string;
  color: AvatarColor;
  role: Role;
  /** Passkey credential ID (card `ki`). */
  keyId?: string;
  /** Passkey public key, raw P-256, base64url (card `pk`). */
  publicKey?: string;
  /** My own card's safety words (derived locally, 6.3). */
  safetyWords?: SafetyWordsT;
  /** EXTENSION: when the key was created (I1b shows "Key ready · created 12 Sep"). */
  keyCreatedAt?: number;
  /** EXTENSION: what kind of key answers for this phone. */
  keyKind?: "passkey";
  lang: Lang;
  /** Hindi verb endings only (रहा/रही/रहे); 'n' = respectful plural. */
  hindiForm: HindiForm;
  theme: ThemePref;
  textSize: TextSize;
  reduceMotion: boolean;
  soundsOn: boolean;
  createdAt: number;
  setupComplete: boolean;
}

/** What a QR code / family link carries (card v2, backend spec 6.1). */
export interface FamilyCard {
  v: 2;
  deviceId: string;
  name: string;
  phone?: string;
  color: AvatarColor;
  canBeVerified: boolean;
  /** Device signing public key (raw, base64url): checks sender signatures. */
  devicePub: string;
  /** Device encryption public key (raw, base64url): seals envelopes to them. */
  encPub: string;
  /** Contact grant "<grantId>.<secret>": first contact through the relay (6.4). */
  grant: string;
  keyType?: "pk";
  /** Passkey credential ID. */
  keyId?: string;
  /** Passkey public key (raw, base64url): verifier checks 2 and 6. */
  publicKey?: string;
  /** When the card was made. */
  createdAt: number;
  /** Derived on THIS phone from the keys (PBKDF2, 6.3); never read from the card. */
  safetyWords: SafetyWordsT;
}

export interface FamilyMember extends FamilyCard {
  id: string;
  /** What I call them, e.g. "Arjun" or "Maa". */
  label: string;
  relation: Relation;
  addedAt: number;
  addedBy: "in_person" | "family_link";
  /** EXTENSION: last time I checked this person (D1 sorts by most recently checked). */
  lastCheckedAt?: number;
}

/** The recipient details a sender needs (from the saved card). */
export type RecipientCard = Pick<FamilyCard, "deviceId" | "grant" | "encPub" | "devicePub">;

export interface VerifyRequest {
  /** A ULID; also the id of the `send` frame that carries the request (D-009). */
  requestId: string;
  /** 32 random bytes, base64url. */
  nonce: string;
  fromDeviceId: string;
  /** How the answerer knows the asker; the answerer resolves it from their own family list. */
  fromLabel: string;
  fromName: string;
  toDeviceId: string;
  claimedLabel: string;
  reason?: AskReason;
  amountInr?: number;
  channel: "call";
  createdAt: number;
  /** createdAt + 60_000, on the ASKER's clock (never compared with another phone's clock, 8.7). */
  expiresAt: number;
  /** EXTENSION (local only, never on the wire, D-014): the asker's own phone number. */
  fromPhone?: string;
}

/** A request as it arrives on the answerer's phone (8.7): the time left comes from the relay. */
export interface IncomingRequest {
  req: VerifyRequest;
  /** The relay-authenticated sender. */
  envFrom: string;
  /** Time left on the relay's clock when it was delivered. */
  ttlMs: number;
  /** When THIS phone received it (its own clock). */
  receivedAt: number;
  /** The asker's device keys, from the payload (so an answer can go back even to a stranger). */
  senderDevicePub: string;
  senderEncPub: string;
}

/** What onAnswer delivers (22.2): the verifier needs all of it. */
export interface IncomingAnswer {
  /** Absent when the envelope couldn't be opened or read (9.4). */
  ans?: WireAnswer;
  sealOk: boolean;
  /** The relay-authenticated sender. */
  envFrom: string;
  /** The request this answers. */
  re: string;
  /** When THIS phone received it. */
  receivedAt: number;
  /** The relay marked it as arriving within the 30 s grace (informational only). */
  late?: boolean;
}

export type CheckKey = "fresh" | "key" | "exact" | "address" | "unlocked" | "signature" | "unused";

export interface CheckResult {
  n: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  key: CheckKey | string;
  passed: boolean;
  /** 22.2: not checked (an unreadable seal: only check 3 is reported as failed, 9.4). */
  skipped?: boolean;
  detail?: string;
  /** EXTENSION: numbers used to render the label ("sent {n} s ago"). */
  params?: Record<string, string | number>;
}

export interface VerdictResult {
  requestId: string;
  verdict: Verdict;
  invalidReason?: InvalidReason;
  noResponseReason?: NoResponseReason;
  /** 22.2: a DENIED that arrived after the timer (10.7). */
  late?: boolean;
  checks: CheckResult[];
  memberId?: string;
  memberLabel: string;
  reason?: AskReason;
  amountInr?: number;
  elapsedMs?: number;
  confirmationWords?: [string, string];
  decidedAt: number;
  /** EXTENSION: when THIS phone received the signed answer (E1/E2 "{label}'s key · 4 s ago"). Never the
   *  answerer's own timestamp: another phone's clock is never compared with this one (8.7). */
  answeredAt?: number;
}

export interface FamilyAlert {
  id: string;
  type: "impersonation" | "check_on";
  aboutLabel: string;
  /** 22.2: the sender's own name (was victimLabel). */
  victimName: string;
  victimPhone?: string;
  amountInr?: number;
  createdAt: number;
  read: boolean;
  /** Lets each recipient show its OWN label for the person (7.4). */
  aboutDeviceId?: string;
  /** EXTENSION (local): who sent it, from the relay-authenticated envelope. */
  victimDeviceId?: string;
  /** EXTENSION (local): phone of the person asked about, from MY family list (G2 "Call {about}"). */
  aboutPhone?: string;
  /** EXTENSION (local): G2 "I've reached them" marks it resolved. */
  resolved?: boolean;
}

export interface HistoryEvent {
  id: string;
  kind: "checked" | "answered";
  personLabel: string;
  verdict?: Verdict;
  invalidReason?: InvalidReason;
  decision?: Decision;
  reason?: AskReason;
  amountInr?: number;
  at: number;
  checks?: CheckResult[];
  elapsedMs?: number;
  /** EXTENSION: links the event to a member (C6 "Recent checks") and to its request. */
  memberDeviceId?: string;
  requestId?: string;
  /** EXTENSION: timeline for H2 (asked → answered → result). */
  askedAt?: number;
  answeredAt?: number;
  /** EXTENSION: the check was cancelled on D3 (no verdict). */
  cancelled?: boolean;
  noResponseReason?: NoResponseReason;
  late?: boolean;
  /** EXTENSION: the event's detail view has already played its draw animation once. */
  viewed?: boolean;
}

export type Tactic = "identity" | "money" | "urgency" | "secrecy" | "otp" | "authority";

export interface GuardSignals {
  claimedLabel?: string;
  amountInr?: number;
  tactics: Tactic[];
  /** 0 idle, 1 claim, 2 pressure, 3 secrecy, 4 money */
  stage: 0 | 1 | 2 | 3 | 4;
  /** EXTENSION: the words that matched, for highlighting in the transcript. */
  matches?: string[];
}

export interface GuardPrompt {
  claimedLabel: string;
  /** 7.4: the Guard's saved device for the claimed person, when it knows one. */
  claimedDeviceId?: string;
  amountInr?: number;
  tactics: GuardSignals["tactics"];
  at: number;
}

export interface RelayEvent {
  id: string;
  at: number;
  /** EXTENSION: "guard" for Call Guard prompts. */
  kind: "request" | "answer" | "alert" | "presence" | "guard";
  from: string;
  to: string;
  summary: string;
  payload: unknown;
  tampered?: "change" | "replay" | "forge";
  verdictSeen?: Verdict;
  /** EXTENSION: the request this message belongs to (links answers and verdicts). */
  requestId?: string;
}

// ─── B3 · Service interfaces ────────────────────────────────────────────────────────

export interface KeyService {
  checkSupport(): Promise<{ passkeys: boolean; screenLock: "yes" | "no" | "unknown" }>;
  /** Creates this phone's passkey (10.3). The safety words come from the whole card, not the key. */
  createKey(p: { deviceId: string; name: string }): Promise<{ keyId: string; publicKey: string }>;
  /**
   * Computes both challenges for this request when F1 opens (10.4), so the tap handler can start the
   * passkey prompt without any `await` in between (Safari's user-gesture rule).
   */
  prepareAnswer(req: VerifyRequest, localDeadline?: number): Promise<void>;
  /** Opens the phone's own fingerprint/PIN prompt, then signs request + decision together. Call it FIRST in
   *  the tap handler, with nothing awaited before it. */
  signAnswer(req: VerifyRequest, decision: Decision): Promise<WireAnswer>;
  deleteKey(): Promise<void>;
}

/** EXTENSION: who is on the relay, for the Lab's and Call Guard's device pickers. */
export interface PeerInfo {
  deviceId: string;
  name: string;
  kind: "phone" | "lab" | "guard";
  canBeVerified?: boolean;
  lastSeen: number;
}

export interface Receipt {
  of: string;
  re?: string;
  to?: string;
  state: ReceiptState;
  reason?: string;
}

export interface CancelNotice {
  requestId: string;
  reason: "asker_cancelled" | "answered_elsewhere" | "expired";
  from: string;
}

export interface Contact {
  deviceId: string;
  since: number;
  via: "grant" | "unrevoked";
}

export interface PushSubscriptionInfo {
  endpoint: string;
  p256dh: string;
  auth: string;
  vapidKeyId: string;
}

/** EXTENSION (Diagnostics, FC-20): what this phone knows about its relay session. */
export interface RelayInfo {
  env?: string;
  gatewayId?: string;
  e2eRequired?: boolean;
  pushStatus?: "ok" | "missing" | "expired";
  /** The VAPID key the relay signs pushes with (hello); a new one makes the app re-subscribe (11.9). */
  vapidKeyId?: string;
  lab?: { optedIn: boolean; until?: number };
  /** Every simulated or real relay reports the message kinds it sends end-to-end sealed. */
  e2e: boolean;
}

export interface RelayService {
  connect(deviceId: string): void;
  onState(cb: (s: ConnectionState) => void): Unsubscribe;
  onPresence(cb: (reachableDeviceIds: string[]) => void): Unsubscribe;
  /** Resolves when the relay confirms `accepted` (8.4); rejects after 5 s without it. */
  sendRequest(req: VerifyRequest, to: RecipientCard): Promise<void>;
  onRequest(cb: (r: IncomingRequest) => void): Unsubscribe;
  /** Goes back to whoever asked, using the keys that came with the request. */
  sendAnswer(ans: WireAnswer, to: { deviceId: string; encPub: string; devicePub: string }): Promise<void>;
  onAnswer(cb: (a: IncomingAnswer) => void): Unsubscribe;
  /** One sealed envelope per recipient (13.1). Returns each recipient's message id (receipts use it). */
  sendAlert(alert: FamilyAlert, to: RecipientCard[]): Promise<Array<{ deviceId: string; msgId: string }>>;
  onAlert(cb: (alert: FamilyAlert) => void): Unsubscribe;
  sendGuardPrompt(p: GuardPrompt, to: RecipientCard): Promise<void>;
  onGuardPrompt(cb: (p: GuardPrompt) => void): Unsubscribe;
  onReceipt(cb: (r: Receipt) => void): Unsubscribe;
  onCancel(cb: (c: CancelNotice) => void): Unsubscribe;
  cancelRequest(requestId: string): Promise<void>;
  markSeen(requestId: string): void;
  /** Asks who is reachable now (12): `online`, `push` (phone in a pocket) or `offline`. */
  queryPresence(deviceIds: string[]): Promise<Record<string, PresenceState>>;
  pushSubscribe(sub: PushSubscriptionInfo): void;
  contacts(): Promise<Contact[]>;
  revokeContact(deviceId: string): Promise<void>;
  unrevokeContact(deviceId: string): Promise<void>;
  /** "Reset my code": a new grant (old cards stop working for NEW people). Returns the new grant. */
  rotateGrant(): Promise<string>;
  /** "Delete my data" (6.6): the relay forgets this device. */
  retire(): Promise<void>;
  /** serverTime − localNow, for display only (8.7). */
  clockOffsetMs(): number;
  /** Diagnostics "Send test alert" (11.8): a push to this phone after 10 s. */
  sendTestAlert(): Promise<void>;

  // EXTENSIONS used by Diagnostics (J3), the Lab (J1) and Call Guard (J2).
  /** Name and kind shown to other simulated tabs (the real relay knows no names). */
  announce(info: { name: string; kind: PeerInfo["kind"]; canBeVerified?: boolean }): void;
  onPeers(cb: (peers: PeerInfo[]) => void): Unsubscribe;
  getState(): ConnectionState;
  /** Round-trip time in ms. */
  ping(): Promise<number>;
  reconnect(): void;
  /** Human-readable relay address for Diagnostics. */
  address(): string;
  lastMessageAt(): number | null;
  info(): RelayInfo;
  /** The relay session's details whenever they change (login, Lab opt-in): Diagnostics and the Lab banner. */
  onInfo(cb: (i: RelayInfo) => void): Unsubscribe;
  /** A newer app version is required (close 4426, FC-23). */
  onUpdateRequired(cb: () => void): Unsubscribe;
  /**
   * Called by the asker's phone after it verifies an answer, so the Security Lab can show what Maa's phone
   * showed (lab.report, 14.2). Ignored unless this phone is opted in to the Lab.
   */
  reportVerdict(r: {
    requestId: string;
    verdict: Verdict;
    invalidReason?: InvalidReason;
    failedChecks: number[];
  }): void;
  /** EXTENSION (14.1 layer 3): opt this phone in to the Security Lab (asks for the Lab password), or out. */
  labOptIn(password: string): Promise<void>;
  labOptOut(): Promise<void>;
}

export interface VerifierService {
  /** Runs the 7 checks. Never returns VERIFIED unless all 7 pass and decision === 'ME'.
   *  `member` is always the saved card for req.toDeviceId (10.5). */
  verify(i: { req: VerifyRequest; incoming: IncomingAnswer; member: FamilyMember }): Promise<VerdictResult>;
  /** EXTENSION: Diagnostics → "Reset used request numbers" (test builds only, 10.9). */
  resetUsedNonces(): Promise<void>;
}

export type CardErrorCode = "not_pehchaan" | "corrupt" | "own_card" | "old_version" | "altered";

export class CardError extends Error {
  code: CardErrorCode;
  /** For old_version: the name on the old card. */
  cardName?: string;
  constructor(code: CardErrorCode, cardName?: string) {
    super(code);
    this.name = "CardError";
    this.code = code;
    if (cardName) this.cardName = cardName;
  }
}

/** The new-phone guard's verdict on a card (6.5). */
export type CardGuard =
  | { kind: "new" }
  | { kind: "already"; member: FamilyMember }
  | { kind: "altered"; member: FamilyMember }
  | { kind: "impostor"; member: FamilyMember; match: "name" | "phone" };

export interface CardService {
  /** https://<origin>/join#c=<base64url JSON> */
  toLink(card: FamilyCard): string;
  /** Validates (6.1) and derives the safety words locally. Throws CardError. */
  fromLink(urlOrText: string): Promise<FamilyCard>;
  /** The 6.5 guard against my family list. */
  guard(card: FamilyCard, family: FamilyMember[]): CardGuard;
}

export type AttackKind = "change" | "replay" | "forge";

/** EXTENSION: one attack and its outcome, kept in the Lab's all-time log. */
export interface LabAttackRecord {
  id: string;
  at: number;
  attack: AttackKind;
  requestId: string;
  targetDeviceId: string;
  askerDeviceId: string;
  verdictSeen?: Verdict;
  invalidReason?: InvalidReason;
  failedChecks?: number[];
  falseGreen: boolean;
  /** Forge variant: the forger copied the target's real credential ID (→ bad_signature). */
  copiedCredId?: boolean;
}

/** EXTENSION: the Lab's live state. */
export interface LabStatus {
  attackerMode: boolean;
  armed: AttackKind | null;
  canReplay: boolean;
  lastAttack: LabAttackRecord | null;
  since: number;
  /** The real relay's Lab: joined with the password, and the runtime switch is on. */
  joined?: boolean;
  /** Devices opted in to the Lab (14.1 layer 3). */
  optedIn?: string[];
  notice?: string;
}

export interface LabService {
  onTraffic(cb: (e: RelayEvent) => void): Unsubscribe;
  arm(attack: AttackKind, opts?: { copyCredId?: boolean }): void;
  disarm(): void;
  setAttackerMode(on: boolean): void;
  onCounters(cb: (c: { attacks: number; falseGreens: number }) => void): Unsubscribe;
  reset(): void;

  // EXTENSIONS
  start(): void;
  stop(): void;
  onStatus(cb: (s: LabStatus) => void): Unsubscribe;
  onPeers(cb: (peers: PeerInfo[]) => void): Unsubscribe;
  /** Which devices play "Maa's phone" and "Arjun's phone" in the pipeline. */
  setRoles(r: { askerDeviceId?: string; targetDeviceId?: string }): void;
  attackLog(): Promise<LabAttackRecord[]>;
  clearLog(): void;
  /** The real relay's Lab asks for the Lab password first (14.1 layer 2). */
  join?(password: string): Promise<void>;
  needsPassword?: boolean;
}

export interface GuardService {
  start(mode: "microphone" | "scripted"): Promise<void>;
  stop(): void;
  onTranscript(cb: (line: { text: string; final: boolean; at: number }) => void): Unsubscribe;
  onSignals(cb: (s: GuardSignals) => void): Unsubscribe;

  // EXTENSIONS
  /** Names and labels to listen for as identity claims ("main Arjun"). */
  setNames(names: string[]): void;
  /** Scripted mode: play the next line now. */
  next(): void;
  /** 0..1 audio level for the waveform (≈30 fps). */
  onLevel(cb: (level: number) => void): Unsubscribe;
  micSupported(): boolean;
}

/** EXTENSION: builds requests; nonces need crypto, which stays inside the service layer. */
export interface RequestFactory {
  create(p: {
    from: { deviceId: string; name: string; phone?: string };
    member: FamilyMember;
    reason?: AskReason;
    amountInr?: number;
  }): VerifyRequest;
  /** Two words both phones derive from a signed answer (10.8, E7, F3). */
  confirmationWords(ans: WireAnswer): Promise<[string, string]>;
  randomId(prefix?: string): string;
}

export interface Services {
  key: KeyService;
  relay: RelayService;
  verifier: VerifierService;
  card: CardService;
  lab: LabService;
  guard: GuardService;
  requests: RequestFactory;
}

// ─── Simulation-only controls (Diagnostics → Simulation panel) ─────────────────────

export type AutoAnswerMode =
  "off" | "not_me" | "yes" | "never" | "tamper_changed" | "tamper_reused" | "tamper_wrong_key";

export type KeyOutcome = "success" | "no_screen_lock" | "no_passkeys" | "cancelled";

export interface SimControls {
  setAutoAnswer(mode: AutoAnswerMode): Promise<void>;
  getAutoAnswer(): Promise<AutoAnswerMode>;
  forceConnection(state: ConnectionState | null): void;
  forcedConnection(): ConnectionState | null;
  setKeyOutcome(o: KeyOutcome): Promise<void>;
  getKeyOutcome(): Promise<KeyOutcome>;
}
