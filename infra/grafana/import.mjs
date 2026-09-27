// Loads the dashboards and alert rules (spec 19.3, 19.5) into a Grafana (Grafana Cloud or self-hosted) through its
// HTTP API. Run it from a laptop after changing anything in infra/grafana (docs/RUNBOOKS.md, "Grafana setup"):
//
//   GRAFANA_URL=https://<stack>.grafana.net \
//   GRAFANA_TOKEN=<a service account token with the Editor role> \
//   GRAFANA_PROM_UID=<uid of the Prometheus data source that Alloy writes to> \
//   node infra/grafana/import.mjs
//
// Idempotent: dashboards are overwritten by uid, and each alert rule group is replaced as a whole. Everything goes
// into one folder, "Pehchaan". The token is read from the environment and never printed.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLDER = { uid: "pehchaan", title: "Pehchaan" };

const url = process.env.GRAFANA_URL?.replace(/\/$/, "");
const token = process.env.GRAFANA_TOKEN;
const promUid = process.env.GRAFANA_PROM_UID;
if (!url || !token || !promUid) {
  console.error("set GRAFANA_URL, GRAFANA_TOKEN and GRAFANA_PROM_UID (see the comment at the top of this file)");
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function must(method, path, body) {
  const r = await api(method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// 1. The folder (created unless it already exists).
const folder = await api("GET", `/api/folders/${FOLDER.uid}`);
if (folder.status !== 200) {
  const created = await api("POST", "/api/folders", FOLDER);
  if (created.status >= 300) {
    throw new Error(`folder: GET HTTP ${folder.status}, POST HTTP ${created.status} ${JSON.stringify(created.body)}`);
  }
}

// 2. Dashboards. They read from a data source variable (DS_PROMETHEUS), so no uid needs rewriting.
const dashDir = join(HERE, "dashboards");
for (const file of readdirSync(dashDir).filter((f) => f.endsWith(".json"))) {
  const dashboard = JSON.parse(readFileSync(join(dashDir, file), "utf8"));
  await must("POST", "/api/dashboards/db", {
    dashboard: { ...dashboard, id: null },
    folderUid: FOLDER.uid,
    overwrite: true,
  });
  console.log(`dashboard ${dashboard.uid}`);
}

// 3. Alert rules, one group at a time. Their queries name the data source as ${DS_PROMETHEUS}; point it at the real one.
const alerts = JSON.parse(readFileSync(join(HERE, "alerts.json"), "utf8"));
const seconds = (d) => Number(/^(\d+)m$/.exec(d)?.[1] ?? NaN) * 60 || Number(/^(\d+)s$/.exec(d)?.[1]);
for (const group of alerts.groups) {
  const rules = group.rules.map((rule) => ({
    ...rule,
    folderUID: FOLDER.uid,
    ruleGroup: group.name,
    data: rule.data.map((q) => (q.datasourceUid === "${DS_PROMETHEUS}" ? { ...q, datasourceUid: promUid } : q)),
  }));
  await must("PUT", `/api/v1/provisioning/folder/${FOLDER.uid}/rule-groups/${encodeURIComponent(group.name)}`, {
    title: group.name,
    folderUid: FOLDER.uid,
    interval: seconds(group.interval),
    rules,
  });
  console.log(`alert group ${group.name}: ${rules.length} rules`);
}
