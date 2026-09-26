// The Security Lab on the relay (spec 14): the interface the rest of the relay uses. The module is created
// only when LAB_ENABLED=true (lab/module.ts), and even then does nothing until `admin lab on`.
import type { ClientFrame } from "@pehchaan/protocol";
import type { StoredFrame } from "../core/inbox";
import type { Connection } from "../ws/connection";

export interface LabModule {
  /** The runtime switch cfg:lab is on (14.1 layer 1). */
  isOn(): Promise<boolean>;
  /** The device opted in within the last 4 h (layer 3). */
  isOptedIn(deviceId: string): Promise<boolean>;
  /** For auth.ok: { optedIn, until? }. */
  optInState(deviceId: string): Promise<{ optedIn: boolean; until?: number }>;
  /** Called for every envelope before routing. True when the Lab took it (held or dropped for an attack);
   *  it only ever looks at envelopes whose sender AND recipient are opted in (layer 4). */
  intercept(stored: StoredFrame, to: string): Promise<boolean>;
  /** lab.* messages from Lab pages and phones. */
  handle(conn: Connection, f: Extract<ClientFrame, { t: `lab.${string}` }>): Promise<void>;
  /** After a login: send the phone or Lab page the current lab.state. */
  onLogin(conn: Connection): Promise<void>;
  /** A socket closed. */
  onClose(conn: Connection): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
