// J-12 (backend spec 14, Part E): the Security Lab against the real relay. A laptop joins the Lab with the password;
// Maa's and Arjun's phones allow the Lab in Diagnostics; then 50 automated attacks (change, replay, forge, and
// forge with Arjun's real credential ID copied). Maa's phone runs the normal verifier every time: each verdict must
// be "Fake answer" for the reason in the 10.5 table, and the false-green counter must stay 0.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addInPerson, answer, ask, closeAll, linkOf, newPhone, setUp, verdict, type Phone } from "./fixtures/app";
import { LAB_PASSWORD, RELAY_ENV } from "./playwright.config";

/** `admin lab on|off` (14.1 layer 1), exactly as the team runs it, against this test relay. */
function labSwitch(on: boolean) {
  execFileSync(process.execPath, ["--import", "tsx", "src/admin.ts", "lab", on ? "on" : "off"], {
    cwd: join(import.meta.dirname, "..", "..", "apps", "relay"),
    env: { ...process.env, ...RELAY_ENV },
    stdio: "pipe",
  });
}

async function allowLab(p: Phone) {
  await p.page.goto("/diagnostics");
  await p.page.getByLabel("Lab password").fill(LAB_PASSWORD);
  await p.page.getByRole("button", { name: "Allow Security Lab on this phone" }).click();
  await expect(p.page.getByText(/The Security Lab can see and change this phone's messages/)).toBeVisible();
  await p.page.goto("/home");
}

const card = (lab: Page, title: RegExp) =>
  lab.locator(".card").filter({ has: lab.getByRole("heading", { name: title }) });

type Plan = "change" | "replay" | "forge" | "forge-copy";
const EXPECTED: Record<Plan, { reason: string; attack: string; copied?: boolean }> = {
  change: { reason: "changed", attack: "change" },
  replay: { reason: "reused", attack: "replay" },
  forge: { reason: "wrong_key", attack: "forge" },
  "forge-copy": { reason: "bad_signature", attack: "forge", copied: true },
};

test.afterAll(() => labSwitch(false));

test("J-12 · 50 attacks from the Security Lab: every one is a Fake answer for the right reason; false greens stay 0", async ({
  browser,
}) => {
  test.setTimeout(30 * 60_000);
  labSwitch(true);
  const [maa, arjun, laptop] = await Promise.all([
    newPhone(browser, "Sunita Sharma"),
    newPhone(browser, "Arjun Sharma"),
    newPhone(browser, "Lab laptop"),
  ]);
  try {
    await setUp(maa, { verifiable: false });
    await setUp(arjun, { verifiable: true });
    await addInPerson(maa, await linkOf(arjun), "Son", "Arjun");
    await addInPerson(arjun, await linkOf(maa), "Mother", "Maa");
    await allowLab(maa);
    await allowLab(arjun);

    // The laptop: the Lab page, joined with the password (14.1 layer 2).
    const lab = laptop.page;
    await lab.setViewportSize({ width: 1400, height: 1000 });
    await lab.goto("/lab");
    await lab.getByLabel("Lab password").fill(LAB_PASSWORD);
    await lab.getByRole("button", { name: "Join", exact: true }).click();
    await expect(lab.getByRole("heading", { name: "Join the Security Lab" })).toBeHidden();
    await lab.getByRole("button", { name: "Reset counters" }).click();

    // One genuine check first: a real "Yes" for the replay, and the Lab learns who asks whom.
    await ask(maa, /Arjun/);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");
    await arjun.page.goto("/home");
    await expect(card(lab, /^Replay Arjun's last yes$/).getByRole("button", { name: "Arm" })).toBeEnabled();

    const plan: Plan[] = [];
    for (let i = 0; i < 50; i++) plan.push((["change", "replay", "forge", "forge-copy"] as const)[i % 4]!);

    for (const [i, p] of plan.entries()) {
      const title =
        p === "change" ? /^Change the next answer$/ : p === "replay" ? /^Replay Arjun's last yes$/ : /^Forge a yes$/;
      const c = card(lab, title);
      if (p.startsWith("forge")) await c.getByLabel("Use Arjun's real key ID").setChecked(p === "forge-copy");
      await c.getByRole("button", { name: "Arm" }).click();
      await expect(c.getByText(/^Armed: waiting for the next check/)).toBeVisible();
      await ask(maa, /Arjun/);
      // A changed answer is Arjun's own NOT ME, held and flipped; replay and forge never reach Arjun at all.
      if (p === "change") {
        await answer(arjun, "no");
        await arjun.page.goto("/home");
      }
      expect(await verdict(maa), `attack ${i + 1} (${p})`).toBe("Fake answer");
    }

    // The Lab's all-time log (14.4): 50 attacks, each INVALID for its reason, and no false green.
    await expect
      .poll(async () => (await exportLog(lab)).filter((a) => a.verdictSeen).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(50);
    const log = (await exportLog(lab)).slice(-50);
    for (const [i, a] of log.entries()) {
      const want = EXPECTED[plan[i]!];
      expect(a, `attack ${i + 1} (${plan[i]})`).toMatchObject({
        attack: want.attack,
        verdictSeen: "INVALID",
        invalidReason: want.reason,
        falseGreen: false,
        ...(want.copied ? { copiedCredId: true } : {}),
      });
    }
    // Saved as the evidence the spec asks for (Report B2: docs/lab-log-phase7.json).
    writeLog(log);
  } finally {
    await closeAll(maa, arjun, laptop);
  }
});

type Logged = {
  attack: string;
  verdictSeen?: string;
  invalidReason?: string;
  falseGreen: boolean;
  copiedCredId?: boolean;
};

async function exportLog(lab: Page): Promise<Logged[]> {
  const [download] = await Promise.all([
    lab.waitForEvent("download"),
    lab.getByRole("button", { name: "Export attack log (JSON)" }).click(),
  ]);
  const text = readFileSync((await download.path())!, "utf8");
  return (JSON.parse(text) as { attacks: Logged[] }).attacks;
}

function writeLog(log: Logged[]) {
  const out = join(import.meta.dirname, "..", "..", "docs", "lab-log-phase7.json");
  const summary = {
    generatedBy: "tests/e2e/lab.spec.ts › J-12 (real relay, real passkeys, the normal verifier on Maa's phone)",
    attacks: log.length,
    falseGreens: log.filter((a) => a.falseGreen).length,
    byReason: log.reduce<Record<string, number>>(
      (m, a) => ((m[`${a.attack}:${a.invalidReason}`] = (m[`${a.attack}:${a.invalidReason}`] ?? 0) + 1), m),
      {},
    ),
    log,
  };
  writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
}
