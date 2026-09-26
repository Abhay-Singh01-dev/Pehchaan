// Who may contact me, on the relay (backend spec 6.4, FC-19).
//
// "Remove {label}" (C7) sends contact.revoke; adding someone in person (C5) sends contact.unrevoke. Both must
// reach the relay even when the phone is offline at that moment, so they wait in a small persistent queue and
// are sent in order whenever the relay connects. Only the latest operation per device matters (remove then
// re-add ends unblocked), so a newer one replaces an older one.
import { services } from "@/services";
import { getMeta, setMeta } from "@/store/meta";

type ContactOp = { op: "revoke" | "unrevoke"; deviceId: string };

let flushing: Promise<void> | null = null;

async function readOps(): Promise<ContactOp[]> {
  return (await getMeta<ContactOp[]>("relay:contactOps")) ?? [];
}

export async function queueContactOp(op: ContactOp["op"], deviceId: string): Promise<void> {
  const ops = (await readOps()).filter((o) => o.deviceId !== deviceId);
  ops.push({ op, deviceId });
  await setMeta("relay:contactOps", ops);
  void flushContactOps();
}

/** Sends queued operations in order; stops at the first failure and tries again at the next connection. */
export function flushContactOps(): Promise<void> {
  flushing ??= (async () => {
    try {
      for (;;) {
        const [next] = await readOps();
        if (!next) return;
        if (next.op === "revoke") await services.relay.revokeContact(next.deviceId);
        else await services.relay.unrevokeContact(next.deviceId);
        // Remove it only if it wasn't replaced while it was being sent.
        const ops = await readOps();
        if (ops[0]?.deviceId === next.deviceId && ops[0].op === next.op)
          await setMeta("relay:contactOps", ops.slice(1));
      }
    } catch {
      // Offline or refused: keep the queue for the next connection.
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

let installed = false;
export function installContactSync() {
  if (installed) return;
  installed = true;
  services.relay.onState((s) => {
    if (s === "connected") void flushContactOps();
  });
}
