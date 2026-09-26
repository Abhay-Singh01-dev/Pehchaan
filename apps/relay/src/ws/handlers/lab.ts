// lab.* messages (spec 14.2). When the Lab module isn't loaded (LAB_ENABLED=false), every lab.* is refused
// with lab_disabled (14.1 layer 1, SEC-09).
import type { ClientFrame } from "@pehchaan/protocol";
import type { Hub } from "../../hub";
import { labAvailable } from "../../core/authz";
import type { Connection } from "../connection";

export async function handleLab(hub: Hub, conn: Connection, f: ClientFrame): Promise<void> {
  await labAvailable(hub);
  await hub.lab!.handle(conn, f as Extract<ClientFrame, { t: `lab.${string}` }>);
}
