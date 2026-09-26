// Bulk data operations: Diagnostics tools (J3) and "Delete all data" (I5).
import { db } from "./db";
import { deleteMeta } from "./meta";

/** Diagnostics → "Clear requests and history" (used between judging sessions). */
export async function clearRequestsAndHistory(): Promise<void> {
  await db.transaction("rw", [db.outgoing, db.incoming, db.history, db.alerts, db.meta], async () => {
    await db.outgoing.clear();
    await db.incoming.clear();
    await db.history.clear();
    await db.alerts.clear();
    await deleteMeta("lastVerdictRequestId");
  });
}

/** I5 → deletes profile, family, history, alerts, requests and settings on this phone. */
export async function deleteAllData(): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const seeded = await db.meta.get("seeded");
    for (const table of db.tables) {
      // Keep the Lab's attack log: it belongs to the test environment, not to the family app.
      if (table.name === "labAttacks") continue;
      await table.clear();
    }
    // A seeded simulation device stays empty after "Delete all data" instead of re-seeding.
    if (seeded) await db.meta.put(seeded);
  });
}
