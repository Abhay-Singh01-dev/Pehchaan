// C-4a: packages/crypto has no dependencies and uses WebCrypto only (section 4). depcruise enforces the
// import graph in CI; this test fails fast inside the package's own suite.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const srcDir = new URL("../src/", import.meta.url);
const sources = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));

describe("C-4a · WebCrypto only", () => {
  it("declares no runtime or peer dependencies", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it("imports only its own modules: no npm packages, no node: or DOM-only modules", () => {
    for (const f of sources) {
      const src = readFileSync(new URL(f, srcDir), "utf8");
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        expect(m[1], `${f} imports ${m[1]}`).toMatch(/^\.\//);
      }
      expect(src, f).not.toMatch(/\b(require|process|Buffer|window|document|localStorage)\b\s*[.(]/);
    }
  });

  it("never uses `any`", () => {
    for (const f of sources) {
      expect(readFileSync(new URL(f, srcDir), "utf8"), f).not.toMatch(/:\s*any\b|as any\b|<any>/);
    }
  });
});
