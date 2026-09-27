// APP-12 (spec 16.5): the Vercel security headers, the build-time meta CSP, and a page with no inline script (so
// `script-src 'self'` holds).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsp, cspMetaPlugin } from "../../build/csp";

const WEB = join(import.meta.dirname, "..", "..");

describe("vercel.json (16.5)", () => {
  const v = JSON.parse(readFileSync(join(WEB, "vercel.json"), "utf8")) as {
    rewrites: Array<{ source: string; destination: string }>;
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const all = Object.fromEntries(v.headers.find((h) => h.source === "/(.*)")!.headers.map((h) => [h.key, h.value]));

  it("sends every security header of 16.5, exactly", () => {
    expect(all).toEqual({
      "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy":
        "camera=(self), microphone=(self), publickey-credentials-create=(self), publickey-credentials-get=(self), geolocation=(), payment=(), usb=()",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
  });

  it("never caches the service worker, and sends app routes to index.html but not assets", () => {
    expect(v.headers.find((h) => h.source === "/sw.js")!.headers).toEqual([
      { key: "Cache-Control", value: "no-cache" },
    ]);
    const re = new RegExp(`^${v.rewrites[0]!.source.replace("/(", "/(")}$`);
    for (const route of ["/home", "/request/01JB", "/verify/result/x", "/lab"])
      expect(re.test(route), route).toBe(true);
    for (const file of [
      "/assets/index-1.js",
      "/icons/icon-192.png",
      "/sw.js",
      "/manifest.webmanifest",
      "/.well-known/x",
    ]) {
      expect(re.test(file), file).toBe(false);
    }
  });
});

describe("the build-time meta CSP (16.5)", () => {
  it("allows only this origin, the relay (wss and https) and Sentry's ingest host", () => {
    expect(
      buildCsp({
        relayUrl: "wss://relay.pehchaan.in/v1/ws",
        relayHttp: "https://relay.pehchaan.in",
        sentryDsn: "https://abc123@o4507.ingest.de.sentry.io/4508",
      }),
    ).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "font-src 'self'; connect-src 'self' wss://relay.pehchaan.in https://relay.pehchaan.in " +
        "https://o4507.ingest.de.sentry.io; worker-src 'self'; manifest-src 'self'",
    );
  });

  it("without a separate relay or Sentry, connect-src is this origin only", () => {
    expect(buildCsp({})).toContain("connect-src 'self';");
  });

  it("is written into index.html at build time only (the dev server's own scripts would break under it)", () => {
    const plugin = cspMetaPlugin({ relayUrl: "wss://r.example/v1/ws" });
    expect(plugin.apply).toBe("build");
    const html = (plugin.transformIndexHtml as (h: string) => string)('<head><meta charset="UTF-8" /></head>');
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'self\';');
    expect(html).toContain("wss://r.example");
  });

  it("index.html has no inline script: the theme is applied by /boot.js", () => {
    const html = readFileSync(join(WEB, "index.html"), "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\ssrc="/);
      expect(body!.trim()).toBe("");
    }
    expect(readFileSync(join(WEB, "public", "boot.js"), "utf8")).toContain("pehchaan:display:last");
  });
});
