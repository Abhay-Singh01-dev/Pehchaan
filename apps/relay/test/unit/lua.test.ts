// C-B5a: every Lua script lives in its own .lua file with a header comment, and is loaded with defineCommand.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LUA, luaDir } from "../../src/core/redis";

describe("C-B5a · Lua scripts", () => {
  const files = readdirSync(luaDir()).filter((f) => f.endsWith(".lua"));

  it("every file is registered, and every registration has a file", () => {
    expect(files.sort()).toEqual(
      Object.values(LUA)
        .map((d) => d.file)
        .sort(),
    );
  });

  it("each opens with a header comment naming the script, its keys and arguments", () => {
    for (const f of files) {
      const src = readFileSync(join(luaDir(), f), "utf8");
      const name = f.replace(/\.lua$/, "");
      expect(src.startsWith(`-- ${name}:`), f).toBe(true);
      expect(src, f).toMatch(/KEYS\[1\]/);
      expect(src, f).toMatch(/ARGV/);
    }
  });

  it("each declares the right number of keys", () => {
    for (const [, d] of Object.entries(LUA)) {
      const src = readFileSync(join(luaDir(), d.file), "utf8");
      const used = new Set([...src.matchAll(/KEYS\[(\d)\]/g)].map((m) => m[1]));
      expect(used.size, d.file).toBe(d.keys);
    }
  });
});
