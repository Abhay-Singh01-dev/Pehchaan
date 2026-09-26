// Phase 9 #4 / B10: at the narrowest phone width (320 CSS px ≈ 200% zoom), in Hindi, at Extra
// large text, no text is cut off with an ellipsis and no screen scrolls sideways.
import { expect, test } from "@playwright/test";

const ROUTES = [
  "/home",
  "/family",
  "/family/m_seed_arjun",
  "/family/add",
  "/family/my-code",
  "/verify/who",
  "/verify/official",
  "/history",
  "/history/h_seed_arjun",
  "/alerts",
  "/settings",
  "/settings/profile",
  "/settings/display",
  "/settings/delete",
  "/help/how-it-works",
  "/help/limits",
  "/help/suspicious-call",
  "/diagnostics",
];

for (const lang of ["en", "hi"] as const) {
  test(`nothing clips at 320px, Extra large, ${lang}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 700 } });
    const page = await ctx.newPage();
    await page.goto("/?device=maa");
    await page.waitForURL("**/home");
    await page.waitForFunction(() => Boolean((window as never as { __pehchaan?: unknown }).__pehchaan));
    await page.evaluate(
      (l) =>
        (window as never as { __pehchaan: { setPrefs(p: object): Promise<void> } }).__pehchaan.setPrefs({
          textSize: "xlarge",
          lang: l,
        }),
      lang,
    );

    const problems: string[] = [];
    for (const route of ROUTES) {
      await page.evaluate((p) => {
        history.pushState({ idx: 99 }, "", p);
        dispatchEvent(new PopStateEvent("popstate", { state: { idx: 99 } }));
      }, route);
      await page.waitForTimeout(1200);
      const found = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("h1,h2,h3,p,button,span,a,li,label")) {
          if (el.closest(".scroll-x")) continue; // horizontal carousels scroll by design
          const cs = getComputedStyle(el);
          if (cs.textOverflow === "ellipsis" && cs.overflow === "hidden" && el.scrollWidth > el.clientWidth + 1) {
            out.push(`cut off: "${el.textContent?.trim().slice(0, 40)}"`);
          }
        }
        const frame = document.querySelector<HTMLElement>("[data-transition]");
        if (frame && frame.scrollWidth > frame.clientWidth + 1) out.push("the screen scrolls sideways");
        return out;
      });
      problems.push(...found.map((f) => `${route}: ${f}`));
    }
    expect(problems).toEqual([]);
    await ctx.close();
  });
}
