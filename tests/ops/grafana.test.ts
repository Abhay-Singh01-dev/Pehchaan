// OPS-11 (spec 19.3–19.5): the dashboards and alert rules load in Grafana itself, not only as JSON. They are loaded
// exactly the way the team loads them into Grafana Cloud: infra/grafana/import.mjs with a service account token
// (docs/RUNBOOKS.md, "Grafana setup"). Grafana validates every rule and dashboard as it saves them.
// tests/unit/observability.test.ts separately checks that every query uses metrics the relay really exposes.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docker, ok, run, sleep } from "./lib/sh";
import { REPO } from "./lib/stack";

const GRAFANA = "grafana/grafana:12.2.0";
const NAME = "pehchaan-ops-grafana";
const PASSWORD = "ops-test-grafana";
const PROM_UID = "prom";
const DASHBOARDS = join(REPO, "infra", "grafana", "dashboards");
const alerts = JSON.parse(readFileSync(join(REPO, "infra", "grafana", "alerts.json"), "utf8")) as {
  groups: Array<{ name: string; rules: Array<{ uid: string; title: string }> }>;
};

let base = "";
let token = "";
const admin = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}` };
const api = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...admin, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

/** node infra/grafana/import.mjs, as in the runbook. */
const importAll = () =>
  run(process.execPath, [join(REPO, "infra", "grafana", "import.mjs")], {
    env: { GRAFANA_URL: base, GRAFANA_TOKEN: token, GRAFANA_PROM_UID: PROM_UID },
  });

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "pehchaan-grafana-"));
  mkdirSync(join(dir, "datasources"));
  // Stands in for Grafana Cloud's hosted Prometheus (no server needed: nothing is queried).
  writeFileSync(
    join(dir, "datasources", "prometheus.yaml"),
    `apiVersion: 1\ndatasources:\n  - name: Prometheus\n    uid: ${PROM_UID}\n    type: prometheus\n    access: proxy\n    url: http://127.0.0.1:9090\n    isDefault: true\n`,
  );
  await run("docker", ["rm", "-f", NAME]);
  await docker([
    "run",
    "-d",
    "--name",
    NAME,
    "--publish",
    "127.0.0.1::3000",
    "--env",
    `GF_SECURITY_ADMIN_PASSWORD=${PASSWORD}`,
    "--env",
    "GF_ANALYTICS_REPORTING_ENABLED=false",
    "--env",
    "GF_ANALYTICS_CHECK_FOR_UPDATES=false",
    "--env",
    "GF_PLUGINS_PREINSTALL_DISABLED=true",
    "--volume",
    `${join(dir, "datasources")}:/etc/grafana/provisioning/datasources:ro`,
    GRAFANA,
  ]);
  const port = (await ok("docker", ["port", NAME, "3000/tcp"])).trim().split(":").at(-1);
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    const up = await api(`/api/datasources/uid/${PROM_UID}`).then(
      (r) => r.status === 200,
      () => false,
    );
    if (up) break;
    const state = (await ok("docker", ["inspect", "-f", "{{.State.Status}}", NAME])).trim();
    if (state !== "running" || i > 120) {
      const logs = await run("docker", ["logs", "--tail", "40", NAME]);
      throw new Error(`Grafana did not start (${state}):\n${logs.stdout}\n${logs.stderr}`);
    }
    await sleep(1000);
  }
  // A service account with the Editor role and a token, as the runbook creates in Grafana Cloud.
  const sa = await api("/api/serviceaccounts", {
    method: "POST",
    body: JSON.stringify({ name: "pehchaan-import", role: "Editor" }),
  });
  const t = await api(`/api/serviceaccounts/${String(sa.body!.id)}/tokens`, {
    method: "POST",
    body: JSON.stringify({ name: "ops-test" }),
  });
  token = String(t.body!.key);
});

afterAll(async () => {
  await run("docker", ["rm", "-f", NAME]);
});

describe("OPS-11 · Grafana loads the dashboards and alert rules (infra/grafana/import.mjs)", () => {
  it("imports everything with an Editor token, and importing again changes nothing", async () => {
    const first = await importAll();
    expect(first.code, `${first.stdout}\n${first.stderr}`).toBe(0);
    expect(first.stdout).not.toContain(token);
    const again = await importAll();
    expect(again.code, again.stderr).toBe(0);
  });

  it("holds every alert rule from alerts.json, in the Pehchaan folder, reading the real Prometheus source", async () => {
    const r = await api("/api/v1/provisioning/alert-rules");
    expect(r.status).toBe(200);
    const rules = r.body as unknown as Array<{
      uid: string;
      folderUID: string;
      ruleGroup: string;
      data: Array<{ datasourceUid: string }>;
    }>;
    const expected = alerts.groups.flatMap((g) => g.rules.map((x) => x.uid)).sort();
    expect(rules.map((x) => x.uid).sort()).toEqual(expected);
    for (const rule of rules) {
      expect(rule.folderUID).toBe("pehchaan");
      expect(alerts.groups.map((g) => g.name)).toContain(rule.ruleGroup);
      for (const q of rule.data) expect([PROM_UID, "__expr__"]).toContain(q.datasourceUid);
    }
  });

  it.each(readdirSync(DASHBOARDS))("holds %s, bound to Prometheus through its data source variable", async (file) => {
    const dashboard = JSON.parse(readFileSync(join(DASHBOARDS, file), "utf8")) as { uid: string; panels: unknown[] };
    const saved = await api(`/api/dashboards/uid/${dashboard.uid}`);
    expect(saved.status).toBe(200);
    expect((saved.body!.meta as { folderUid: string }).folderUid).toBe("pehchaan");
    const d = saved.body!.dashboard as {
      panels: Array<{ datasource?: { uid?: string } }>;
      templating: { list: Array<{ name: string; type: string; query: string }> };
    };
    expect(d.panels).toHaveLength(dashboard.panels.length);
    // Every panel reads from ${DS_PROMETHEUS}, a data source variable limited to Prometheus sources: the dashboards
    // work in any Grafana (Grafana Cloud included) without editing uids.
    expect(d.templating.list).toContainEqual(
      expect.objectContaining({ name: "DS_PROMETHEUS", type: "datasource", query: "prometheus" }),
    );
    for (const p of d.panels) expect(p.datasource?.uid).toBe("${DS_PROMETHEUS}");
  });
});
