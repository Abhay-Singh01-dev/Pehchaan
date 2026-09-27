// Error reports (spec 16.7): Sentry only when a DSN is configured, collecting no personal data, and every event and
// breadcrumb passes the scrubber first. (16.7 says `sendDefaultPii: false`; Sentry 11 replaced that switch with
// `dataCollection`, so every kind of collection is turned off there instead, D-058.) Loaded lazily, so a build without a DSN ships no Sentry code path at start.
import type { BrowserOptions } from "@sentry/browser";
import { appConfig } from "./config";
import { scrub } from "./scrub";

/** Nothing about the user, their requests or their screen is collected automatically. */
export const NO_PERSONAL_DATA: NonNullable<BrowserOptions["dataCollection"]> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

export function sentryOptions(c: { dsn: string; env: string; build: string }): BrowserOptions | null {
  if (!c.dsn) return null;
  return {
    dsn: c.dsn,
    environment: c.env,
    release: c.build,
    dataCollection: NO_PERSONAL_DATA,
    tracesSampleRate: 0,
    beforeSend: (event) => scrub(event),
    beforeBreadcrumb: (crumb) => scrub(crumb),
  };
}

export function initSentry(): void {
  const options = sentryOptions({ dsn: appConfig.sentryDsn, env: appConfig.env, build: appConfig.build });
  if (!options) return;
  void import("@sentry/browser").then((Sentry) => Sentry.init(options)).catch(() => {});
}
