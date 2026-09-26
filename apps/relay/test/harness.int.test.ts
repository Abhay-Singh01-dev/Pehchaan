// Phase 1: the integration helpers start from a clean state and clean up after themselves.
import { afterEach, describe, expect, it } from "vitest";
import { isolate, type Isolation } from "./helpers/isolation";

describe("integration isolation", () => {
  const opened: Isolation[] = [];
  afterEach(async () => {
    await Promise.all(opened.splice(0).map((i) => i.cleanup().catch(() => {})));
  });

  it("gives each file an empty key prefix and an empty schema", async () => {
    const a = await isolate("harness");
    opened.push(a);
    expect(await a.keys()).toEqual([]);
    expect(await a.tables()).toEqual([]);
  });

  it("keeps two files apart and removes everything on cleanup", async () => {
    const a = await isolate("harness");
    const b = await isolate("harness");
    await a.redis.set(`${a.keyPrefix}x`, "1");
    await a.pool.query("create table t (id int)");
    expect(await b.keys()).toEqual([]);
    expect(await b.tables()).toEqual([]);
    expect(await a.keys()).toEqual([`${a.keyPrefix}x`]);
    expect(await a.tables()).toEqual(["t"]);

    const probe = await isolate("harness-probe");
    opened.push(probe);
    await a.cleanup();
    await b.cleanup();
    expect(await probe.redis.exists(`${a.keyPrefix}x`)).toBe(0);
    const schemas = await probe.pool.query("select 1 from information_schema.schemata where schema_name = $1", [
      a.schema,
    ]);
    expect(schemas.rowCount).toBe(0);
  });
});
