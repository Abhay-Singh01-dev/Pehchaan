// OPS-08 (spec 18): the infrastructure files pass their own linters, each run from a pinned image so every machine
// gets the same verdict: shellcheck (the deploy and backup scripts), hadolint at warning level (the Dockerfiles),
// actionlint (every workflow, including the shell inside it) and cloud-init's schema check.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./lib/sh";
import { REPO } from "./lib/stack";

const TOOLS = {
  shellcheck: "koalaman/shellcheck:v0.11.0",
  hadolint: "hadolint/hadolint:v2.14.0",
  actionlint: "rhysd/actionlint:1.7.12",
  ubuntu: "ubuntu:24.04",
};

const mountRepo = ["--volume", `${REPO}:/repo:ro`, "--workdir", "/repo"];
const report = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`;

describe("OPS-08 · linters", () => {
  it("shellcheck: deploy.sh, backup.sh and restore.sh are clean", async () => {
    const scripts = ["infra/vm/deploy.sh", "infra/backup/backup.sh", "infra/backup/restore.sh"];
    const r = await run("docker", ["run", "--rm", ...mountRepo, TOOLS.shellcheck, "--severity=style", ...scripts]);
    expect(r.code, report(r)).toBe(0);
  });

  it("hadolint --failure-threshold warning: every Dockerfile is clean", async () => {
    const dir = join(REPO, "infra", "docker");
    const files = readdirSync(dir).filter((f) => /^Dockerfile\./.test(f) && !f.endsWith(".dockerignore"));
    expect(files).toEqual(expect.arrayContaining(["Dockerfile.relay", "Dockerfile.backup"]));
    for (const f of files) {
      const r = await run(
        "docker",
        ["run", "--rm", "-i", TOOLS.hadolint, "hadolint", "--failure-threshold", "warning", "-"],
        {
          input: readFileSync(join(dir, f), "utf8"),
        },
      );
      expect(r.code, `${f}: ${report(r)}`).toBe(0);
    }
  });

  it("actionlint: every workflow is clean (with shellcheck on their scripts)", async () => {
    const r = await run("docker", ["run", "--rm", ...mountRepo, TOOLS.actionlint, "-color=false"]);
    expect(r.code, report(r)).toBe(0);
  });

  it("cloud-init schema: cloud-init.yaml is valid user data", async () => {
    // Ubuntu's own cloud-init package (the one the Oracle VM image runs), in a throwaway image built once and cached.
    const image = "pehchaan-ops/cloud-init:24.04";
    const dockerfile = [
      `FROM ${TOOLS.ubuntu}`,
      "RUN apt-get update && apt-get install -y --no-install-recommends cloud-init && rm -rf /var/lib/apt/lists/*",
      "",
    ].join("\n");
    const built = await run("docker", ["build", "--quiet", "--tag", image, "-"], {
      input: dockerfile,
      timeoutMs: 15 * 60_000,
    });
    expect(built.code, report(built)).toBe(0);
    const r = await run("docker", [
      "run",
      "--rm",
      ...mountRepo,
      image,
      "cloud-init",
      "schema",
      "--config-file",
      "infra/vm/cloud-init.yaml",
      "--annotate",
    ]);
    expect(r.code, report(r)).toBe(0);
    expect(report(r)).toMatch(/Valid schema/i);
  });
});
