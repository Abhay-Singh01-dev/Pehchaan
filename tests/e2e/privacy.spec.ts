// J-16, data half (backend spec 9, 0 rule 5): a relay-side capture of every WebSocket frame during a real family's
// checks proves that no name, label, phone number, amount, reason, nonce or signature ever crosses the relay in the
// clear. Maa asks Arjun twice (a NOT ME that alerts Papa, then a Yes); the relay test build writes each frame it
// receives and sends (FRAME_CAPTURE_FILE); this test then reads the real nonces and signatures from the phones
// themselves and scans for them, and for everything personal the family typed.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { addInPerson, answer, ask, closeAll, linkOf, newPhone, setUp, verdict } from "./fixtures/app";
import { FRAMES_FILE } from "./playwright.config";

/** Everything personal, chosen with spaces or long digit runs so it can't occur by chance inside base64. */
const P = {
  maaName: "Sunita Kaveri Sharma",
  arjunName: "Arjun Kaveri Sharma",
  papaName: "Ramesh Kaveri Sharma",
  maaPhone: "98100 00021",
  arjunPhone: "98100 00010",
  labels: ["Arjun Beta Ji", "Maa Ji Ghar", "Ramesh Papa Ji", "Arjun Beta Papa"],
};

/** A readable payload would carry these field names; no frame may contain any of them. */
const PAYLOAD_KEYS = [
  "req",
  "ans",
  "alert",
  "prompt",
  "plain",
  "psig",
  "fromName",
  "claimedLabel",
  "amountInr",
  "nonce",
  "signature",
  "authenticatorData",
  "clientDataJSON",
  "credId",
  "decision",
  "victimName",
  "victimPhone",
  "aboutLabel",
  "tactics",
  "label",
  "name",
  "phone",
];

/** Reads every record of one IndexedDB store on a phone (the app's own database). */
async function readStore(page: Page, store: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    (s) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("pehchaan-default");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction(s, "readonly").objectStore(s).getAll();
          all.onsuccess = () => resolve(all.result as Array<Record<string, unknown>>);
          all.onerror = () => reject(all.error);
        };
      }),
    store,
  );
}

/** Every key and every string value in a parsed frame, walking nested objects. */
function walk(v: unknown, keys: Set<string>, strings: string[]) {
  if (typeof v === "string") strings.push(v);
  else if (Array.isArray(v)) for (const x of v) walk(x, keys, strings);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      keys.add(k);
      walk(x, keys, strings);
    }
}

test("J-16 · no name, label, phone number, amount, reason, nonce or signature ever crosses the relay", async ({
  browser,
}) => {
  const start = Date.now();
  const [maa, arjun, papa] = await Promise.all([
    newPhone(browser, P.maaName),
    newPhone(browser, P.arjunName),
    newPhone(browser, P.papaName),
  ]);
  try {
    await setUp(maa, { verifiable: false, phone: P.maaPhone });
    await setUp(arjun, { verifiable: true, phone: P.arjunPhone });
    await setUp(papa, { verifiable: false });
    await addInPerson(maa, await linkOf(arjun), "Son", P.labels[0]);
    await addInPerson(arjun, await linkOf(maa), "Mother", P.labels[1]);
    await addInPerson(maa, await linkOf(papa), "Husband", P.labels[2]);
    await addInPerson(papa, await linkOf(arjun), "Son", P.labels[3]);

    await ask(maa, /Arjun/); // money, ₹50,000
    await answer(arjun, "no");
    expect(await verdict(maa)).toMatch(/^Not /);
    await expect(papa.page.getByText(/Someone pretended to be/).first()).toBeVisible();
    await arjun.page.goto("/home");
    await ask(maa, /Arjun/);
    await answer(arjun, "yes");
    expect(await verdict(maa)).toBe("Confirmed");

    // The secrets of these checks, read from the phones that hold them.
    const asked = await readStore(maa.page, "outgoing");
    const answered = await readStore(arjun.page, "incoming");
    const nonces = asked.map((r) => (r.request as { nonce: string }).nonce);
    const signatures = answered.map((r) => (r.answer as { signature: string }).signature);
    expect(nonces).toHaveLength(2);
    expect(signatures).toHaveLength(2);

    const frames = readFileSync(FRAMES_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { at: number; dir: string; text: string })
      .filter((f) => f.at >= start);
    const sends = frames.filter((f) => /"t":"(send|deliver)"/.test(f.text));
    expect(sends.length).toBeGreaterThan(8);

    const keys = new Set<string>();
    const strings: string[] = [];
    for (const f of frames) walk(JSON.parse(f.text), keys, strings);
    // 1. No readable payload: none of its field names appears anywhere, and every message is sealed.
    expect(PAYLOAD_KEYS.filter((k) => keys.has(k))).toEqual([]);
    for (const f of sends) {
      const body = (JSON.parse(f.text) as { body: { kind: string; e2e?: unknown; system?: unknown } }).body;
      if (body.kind !== "verify.cancel") expect(body.e2e, f.text.slice(0, 120)).toBeTruthy();
    }
    // 2. Nothing personal, and none of the checks' secrets, in any frame's text.
    const all = frames.map((f) => f.text).join("\n");
    for (const s of [P.maaName, P.arjunName, P.papaName, ...P.labels, ...nonces, ...signatures]) {
      expect(all.includes(s), `found in a frame: ${s.slice(0, 24)}`).toBe(false);
    }
    for (const phone of [P.maaPhone, P.arjunPhone]) expect(all.includes(phone.replace(/\s/g, ""))).toBe(false);
    // 3. No amount or reason as a readable value (base64 blobs and IDs are skipped: they are opaque).
    const readable = strings.filter((s) => !/^[A-Za-z0-9_-]{16,}$/.test(s));
    expect(readable.filter((s) => /50,?000|₹|money|otp|bank/i.test(s))).toEqual([]);
  } finally {
    await closeAll(maa, arjun, papa);
  }
});
