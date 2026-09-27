// The build-time Content-Security-Policy (spec 16.5). `connect-src` differs per environment (the relay's address,
// Sentry's ingest host), so it is written into index.html as a <meta> tag when the app is built; the headers that
// must be real HTTP headers (frame-ancestors…) are in vercel.json.
import type { Plugin } from "vite";

export interface CspInputs {
  /** VITE_RELAY_URL, e.g. wss://relay.example/v1/ws (absent: the relay is on this origin). */
  relayUrl?: string;
  /** VITE_RELAY_HTTP, e.g. https://relay.example. */
  relayHttp?: string;
  /** VITE_SENTRY_DSN: only its ingest host is allowed. */
  sentryDsn?: string;
}

const origin = (u?: string) => {
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

export function buildCsp(i: CspInputs): string {
  // A wss:// URL's origin is reported as "null" by URL, so build it from the host.
  const relayWs = i.relayUrl
    ? (() => {
        try {
          const u = new URL(i.relayUrl);
          return `${u.protocol}//${u.host}`;
        } catch {
          return null;
        }
      })()
    : null;
  const connect = ["'self'", relayWs, origin(i.relayHttp), origin(i.sentryDsn)].filter(
    (x, n, all): x is string => Boolean(x) && all.indexOf(x) === n,
  );
  return [
    "default-src 'self'",
    "script-src 'self'",
    // The animation library sets inline styles; scripts never get 'unsafe-inline'.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self'",
    "manifest-src 'self'",
  ].join("; ");
}

/** Writes the CSP <meta> into index.html, in production builds only: the dev server injects its own scripts.
 *  Without explicit inputs it reads the build's own VITE_* settings (from the environment and .env files). */
export function cspMetaPlugin(given?: CspInputs): Plugin {
  let i: CspInputs = given ?? {};
  return {
    name: "pehchaan-csp-meta",
    apply: "build",
    configResolved(config) {
      if (given) return;
      const env = config.env as Record<string, string | undefined>;
      i = { relayUrl: env.VITE_RELAY_URL, relayHttp: env.VITE_RELAY_HTTP, sentryDsn: env.VITE_SENTRY_DSN };
    },
    transformIndexHtml(html: string) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(i)}" />`;
      return html.replace(/<meta charset="UTF-8" \/>/i, (m) => `${m}\n    ${meta}`);
    },
  };
}
