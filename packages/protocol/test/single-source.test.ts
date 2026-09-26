// PRO-03: the relay and the app import the same schema module; there are no copies.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repo = join(__dirname, "..", "..", "..");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "coverage") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("PRO-03 · one schema module", () => {
  it("both apps depend on @pehchaan/protocol from the workspace", () => {
    for (const app of ["relay", "web"]) {
      const pkg = JSON.parse(readFileSync(join(repo, "apps", app, "package.json"), "utf8"));
      const dep = pkg.dependencies?.["@pehchaan/protocol"] ?? pkg.devDependencies?.["@pehchaan/protocol"];
      expect(dep, app).toBe("workspace:*");
    }
  });

  it("no source outside packages/protocol defines the wire schemas again", () => {
    // Markers that only a copy of the protocol definitions would contain.
    const markers = [/"pehchaan\.v1"/, /CLIENT_BODIES\s*=/, /RELAY_BODIES\s*=/, /verifyRequestPayload\s*=/];
    const offenders: string[] = [];
    for (const dir of [
      "apps/relay/src",
      "apps/web/src",
      "apps/canary/src",
      "apps/loadgen/src",
      "packages/crypto/src",
    ]) {
      let list: string[];
      try {
        list = files(join(repo, dir));
      } catch {
        continue;
      }
      for (const f of list) {
        const src = readFileSync(f, "utf8");
        if (markers.some((m) => m.test(src))) offenders.push(relative(repo, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the protocol package depends on zod only", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "packages", "protocol", "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["zod"]);
  });
});
