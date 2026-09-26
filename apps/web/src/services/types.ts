// Pehchaan service contracts and data model (spec B3 + B4).
//
// Screens only ever talk to these interfaces. `services/index.ts` picks the simulated
// implementations (services/sim) or the team-owned real ones (services/real) by flag.
//
// Additions beyond the spec are marked "EXTENSION" with the reason. Each is optional
// for a real implementation to support in the same shape.

export type Unsubscribe = () => void;

// ─── B4 · Data model ────────────────────────────────────────────────────────────────

export type Lang = "en" | "hi";
export type Role = "can_be_verified" | "checks_only";
export type AvatarColor = "indigo" | "teal" | "saffron" | "rose" | "plum" | "slate";
export type Relation =
  | "son"
  | "daughter"
  | "mother"
  | "father"
  | "husband"
  | "wife"
  | "brother"
  | "sister"
  | "grandchild"
  | "other";
export type AskReason = "money" | "otp" | "bank_details" | "install_app" | "nothing_yet";
export type Decision = "ME" | "NOT_ME";
export type Verdict = "VERIFIED" | "DENIED" | "NO_RESPONSE" | "INVALID" | "UNKNOWN_PERSON";
export type InvalidReason =
  | "changed"
  | "reused"
  | "wrong_key"
  | "wrong_app"
  | "not_unlocked"
  | "bad_signature"
  | "expired";
export type NoResponseReason = "timeout" | "offline" | "relay_unreachable";
export type ConnectionState = "connected" | "reconnecting" | "offline";
export type SafetyWordsT = [string, string, string, string];
export type HindiForm = "m" | "f" | "n";
export type ThemePref = "system" | "light" | "dark";
export type TextSize = "normal" | "large" | "xlarge";

export interface Profile {
  deviceId: string;
  name: string;
  phone?: string;
  color: AvatarColor;
  role: Role;
  keyId?: string;
  publicKey?: string;
  safetyWords?: SafetyWordsT;
  /** EXTENSION: when the key was created (I1b shows "Key ready · created 12 Sep"). */
  keyCreatedAt?: number;
  /** EXTENSION: key made with the 6-digit Pehchaan PIN fallback (A6) instead of a passkey. */
  keyKind?: "passkey" | "pin";
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

/** What a QR code / family link carries. */
export interface FamilyCard {
  v: 1;
  deviceId: string;
  name: string;
  phone?: string;
  color: AvatarColor;
  canBeVerified: boolean;
  keyId?: string;
  publicKey?: string;
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

export interface VerifyRequest {
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
  /** createdAt + 60_000 */
  expiresAt: number;
  /** EXTENSION: the asker's phone, so the answerer can call back (F3) if they're not in the list. */
  fromPhone?: string;
}

export interface SignedAnswer {
  requestId: string;
  nonce: string;
  decision: Decision;
  keyId: string;
  signature: string;
  clientData: string;
  userPresent: boolean;
  userVerified: boolean;
  answeredAt: number;
  fromDeviceId: string;
}

export type CheckKey = "fresh" | "key" | "exact" | "address" | "unlocked" | "signature" | "unused";

export interface CheckResult {
  n: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  key: CheckKey | string;
  passed: boolean;
  detail?: string;
  /** EXTENSION: numbers used to render the label ("sent {n} s ago"). */
  params?: Record<string, string | number>;
}

export interface VerdictResult {
  requestId: string;
  verdict: Verdict;
  invalidReason?: InvalidReason;
  noResponseReason?: NoResponseReason;
  checks: CheckResult[];
  memberId?: string;
  memberLabel: string;
  reason?: AskReason;
  amountInr?: number;
  elapsedMs?: number;
  confirmationWords?: [string, string];
  decidedAt: number;
  /** EXTENSION: when the signed answer was made (E1/E2 "{label}'s key · 4 s ago"). */
  answeredAt?: number;
}

export interface FamilyAlert {
  id: string;
  type: "impersonation" | "check_on";
  aboutLabel: string;
  victimLabel: string;
  victimPhone?: string;
  amountInr?: number;
  createdAt: number;
  read: boolean;
  /** EXTENSION: device ids, so each receiver shows its own saved labels for both people. */
  aboutDeviceId?: string;
  victimDeviceId?: string;
  /** EXTENSION: phone of the person asked about (G2 "Call {about}"). */
  aboutPhone?: string;
  /** EXTENSION: G2 "I've reached them" marks it resolved. */
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
  createKey(p: { deviceId: string; name: string }): Promise<{
    keyId: string;
    publicKey: string;
    safetyWords: SafetyWordsT;
  }>;
  /** Opens the phone's own fingerprint/PIN prompt, then signs request + decision together. */
  signAnswer(req: VerifyRequest, decision: Decision): Promise<SignedAnswer>;
  deleteKey(): Promise<void>;
  /**
   * EXTENSION: the A6 fallback when passkeys aren't supported. Creates a key protected by a
   * 6-digit Pehchaan PIN instead of the phone's own screen lock.
   */
  createPinKey?(p: { deviceId: string; name: string; pin: string }): Promise<{
    keyId: string;
    publicKey: string;
    safetyWords: SafetyWordsT;
  }>;
}

/** EXTENSION: who is on the relay, for the Lab's and Call Guard's device pickers. */
export interface PeerInfo {
  deviceId: string;
  name: string;
  kind: "phone" | "lab" | "guard";
  canBeVerified?: boolean;
  lastSeen: number;
}

export interface RelayService {
  connect(deviceId: string): void;
  onState(cb: (s: ConnectionState) => void): Unsubscribe;
  onPresence(cb: (reachableDeviceIds: string[]) => void): Unsubscribe;
  sendRequest(req: VerifyRequest): Promise<void>;
  onRequest(cb: (req: VerifyRequest) => void): Unsubscribe;
  sendAnswer(ans: SignedAnswer, toDeviceId: string): Promise<void>;
  onAnswer(cb: (ans: SignedAnswer) => void): Unsubscribe;
  sendAlert(alert: FamilyAlert, toDeviceIds: string[]): Promise<void>;
  onAlert(cb: (alert: FamilyAlert) => void): Unsubscribe;
  sendGuardPrompt(p: GuardPrompt, toDeviceId: string): Promise<void>;
  onGuardPrompt(cb: (p: GuardPrompt) => void): Unsubscribe;

  // EXTENSIONS used by Diagnostics (J3), the Lab (J1) and Call Guard (J2).
  /** Name and kind shown to other devices with the presence heartbeat. */
  announce(info: { name: string; kind: PeerInfo["kind"]; canBeVerified?: boolean }): void;
  onPeers(cb: (peers: PeerInfo[]) => void): Unsubscribe;
  getState(): ConnectionState;
  /** Round-trip time in ms. */
  ping(): Promise<number>;
  reconnect(): void;
  /** Human-readable relay address for Diagnostics. */
  address(): string;
  lastMessageAt(): number | null;
  /**
   * Called by the asker's phone after it verifies an answer, so the test-environment Lab
   * can show what Maa's phone showed. The real relay may ignore it outside the test environment.
   */
  reportVerdict(r: { requestId: string; verdict: Verdict; invalidReason?: InvalidReason; failedChecks: number[] }): void;
}

export interface VerifierService {
  /** Runs the 7 checks. Never returns VERIFIED unless all 7 pass and decision === 'ME'. */
  verify(req: VerifyRequest, ans: SignedAnswer, member: FamilyMember): Promise<VerdictResult>;
  /** EXTENSION: Diagnostics → "Reset used request numbers". */
  resetUsedNonces(): Promise<void>;
}

export type CardErrorCode = "not_pehchaan" | "corrupt" | "own_card";

export class CardError extends Error {
  code: CardErrorCode;
  constructor(code: CardErrorCode) {
    super(code);
    this.name = "CardError";
    this.code = code;
  }
}

export interface CardService {
  /** https://<origin>/join#c=<base64url JSON> */
  toLink(card: FamilyCard): string;
  /** Throws CardError: 'not_pehchaan' | 'corrupt' | 'own_card' */
  fromLink(urlOrText: string): FamilyCard;
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
}

/** EXTENSION: the Lab's live state. */
export interface LabStatus {
  attackerMode: boolean;
  armed: AttackKind | null;
  canReplay: boolean;
  lastAttack: LabAttackRecord | null;
  since: number;
}

export interface LabService {
  onTraffic(cb: (e: RelayEvent) => void): Unsubscribe;
  arm(attack: AttackKind): void;
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
  /** Two words both phones derive from a signed answer (E7, F3). */
  confirmationWords(ans: SignedAnswer): Promise<[string, string]>;
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
  | "off"
  | "not_me"
  | "yes"
  | "never"
  | "tamper_changed"
  | "tamper_reused"
  | "tamper_wrong_key";

export type KeyOutcome = "success" | "no_screen_lock" | "no_passkeys" | "cancelled";

export interface SimControls {
  setAutoAnswer(mode: AutoAnswerMode): Promise<void>;
  getAutoAnswer(): Promise<AutoAnswerMode>;
  forceConnection(state: ConnectionState | null): void;
  forcedConnection(): ConnectionState | null;
  setKeyOutcome(o: KeyOutcome): Promise<void>;
  getKeyOutcome(): Promise<KeyOutcome>;
}
