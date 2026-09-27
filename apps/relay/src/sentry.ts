// Error reports from the relay (spec 16.7): only with SENTRY_DSN, collecting no personal data, and every event and
// breadcrumb scrubbed first. (16.7 says `sendDefaultPii: false`; Sentry 11 replaced that switch with
// `dataCollection`, so every kind of collection is turned off there instead, D-058.)
import type { NodeOptions } from "@sentry/node";
import { scrub } from "./scrub";

/** Nothing about users, requests, queries or local variables is collected automatically. */
export const NO_PERSONAL_DATA: NonNullable<NodeOptions["dataCollection"]> = {
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

export function sentryOptions(c: { dsn?: string; env: string; release: string }): NodeOptions | null {
  if (!c.dsn) return null;
  return {
    dsn: c.dsn,
    environment: c.env,
    release: c.release,
    dataCollection: NO_PERSONAL_DATA,
    tracesSampleRate: 0,
    beforeSend: (event) => scrub(event),
    beforeBreadcrumb: (crumb) => scrub(crumb),
  };
}

/** Starts Sentry when configured. Loaded only then, so a relay without a DSN runs no Sentry code at all. */
export async function initSentry(c: { dsn?: string; env: string; release: string }): Promise<boolean> {
  const options = sentryOptions(c);
  if (!options) return false;
  const Sentry = await import("@sentry/node");
  Sentry.init(options);
  return true;
}
