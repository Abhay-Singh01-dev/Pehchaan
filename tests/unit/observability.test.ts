// Phase 9: dashboards and alert rules as code (spec 19.3, 19.5). They must parse, cover every dashboard and every
// alert the spec lists, and only query metrics the relay really exposes (a renamed metric would silently empty a
// panel or disarm an alert).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Every metric name the relay registers (apps/relay/src/metrics.ts). */
const RELAY_METRICS = new Set(
  [...read("apps/relay/src/metrics.ts").matchAll(/name: "(pehchaan_[a-z_]+)"/g)].map((m) => m[1]!),
);
/** pehchaan_* names used in a query, without histogram suffixes. */
const used = (text: string) =>
  [...text.matchAll(/pehchaan_[a-z_]+/g)].map((m) => m[0].replace(/_(bucket|count|sum)$/, ""));

type Dashboard = {
  uid: string;
  title: string;
  panels: Array<{ title: string; datasource: unknown; targets: Array<{ expr: string }> }>;
};
type Alerts = {
  groups: Array<{
    rules: Array<{ uid: string; labels: { severity: string }; data: Array<{ model: { expr?: string } }> }>;
  }>;
};

describe("Grafana dashboards (19.3)", () => {
  const dir = "infra/grafana/dashboards";
  const boards = readdirSync(join(ROOT, dir)).map((f) => JSON.parse(read(`${dir}/${f}`)) as Dashboard);

  it("has the five dashboards, each with queried panels", () => {
    expect(boards.map((b) => b.uid).sort()).toEqual([
      "pehchaan-funnel",
      "pehchaan-infra",
      "pehchaan-lab",
      "pehchaan-overview",
      "pehchaan-push",
    ]);
    for (const b of boards) {
      expect(b.panels.length, b.title).toBeGreaterThan(2);
      for (const p of b.panels) expect(p.targets.length, `${b.title} › ${p.title}`).toBeGreaterThan(0);
    }
  });

  it("queries only metrics the relay exposes", () => {
    const missing = boards
      .flatMap((b) => b.panels.flatMap((p) => p.targets.flatMap((t) => used(t.expr))))
      .filter((m) => !RELAY_METRICS.has(m));
    expect(missing).toEqual([]);
  });

  it("shows the false-green counter on the Security Lab board (a big green 0)", () => {
    const lab = boards.find((b) => b.uid === "pehchaan-lab")!;
    expect(lab.panels.some((p) => p.targets.some((t) => t.expr.includes("pehchaan_lab_false_greens_total")))).toBe(
      true,
    );
  });
});

describe("alert rules (19.5)", () => {
  const alerts = JSON.parse(read("infra/grafana/alerts.json")) as Alerts;
  const rules = alerts.groups.flatMap((g) => g.rules);

  it("pages for every 19.5 condition, and sends notices for the others", () => {
    const pages = rules.filter((r) => r.labels.severity === "page").map((r) => r.uid);
    expect(pages.sort()).toEqual(
      [
        "connections-drop",
        "event-loop-lag",
        "false-green",
        "push-failures",
        "relay-down",
        "server-errors",
        "store-errors",
      ].sort(),
    );
    const notices = rules.filter((r) => r.labels.severity === "notice").map((r) => r.uid);
    expect(notices.sort()).toEqual(["backup-missing", "cert-expiry", "disk-70"]);
    // The canary runs on GitHub, so its "3 failures in a row" page is in its workflow.
    expect(read(".github/workflows/canary.yml")).toContain("page after three failures in a row");
  });

  it("uses only relay metrics that exist (the backup heartbeat comes from the backup job, Phase 10)", () => {
    const missing = rules
      .flatMap((r) => r.data.flatMap((d) => used(d.model.expr ?? "")))
      .filter((m) => !RELAY_METRICS.has(m) && m !== "pehchaan_backup_last_success_timestamp_seconds");
    expect(missing).toEqual([]);
  });
});
