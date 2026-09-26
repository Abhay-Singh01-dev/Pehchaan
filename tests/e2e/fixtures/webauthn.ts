// A virtual WebAuthn authenticator per browser context, through the Chrome DevTools Protocol (spec 21.3).
// It behaves like a phone's platform authenticator: resident keys, user verification (a "fingerprint"
// that always succeeds unless the test turns it off), and automatic user presence.
import type { BrowserContext, CDPSession, Page } from "@playwright/test";

export interface VirtualAuthenticator {
  cdp: CDPSession;
  authenticatorId: string;
  /** Simulates the fingerprint/PIN failing (UV false) or succeeding. */
  setUserVerified(ok: boolean): Promise<void>;
  /** Simulates the person dismissing the prompt: no presence, so the ceremony never completes. */
  setPresence(ok: boolean): Promise<void>;
  credentials(): Promise<Array<{ credentialId: string; rpId?: string; signCount: number }>>;
  remove(): Promise<void>;
}

export async function addVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    cdp,
    authenticatorId,
    async setUserVerified(ok) {
      await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: ok });
    },
    async setPresence(ok) {
      await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId, enabled: ok });
    },
    async credentials() {
      const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
      return credentials;
    },
    async remove() {
      await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    },
  };
}

/** The three phones (plus a spare) of the journeys: each context has its own storage and authenticator. */
export async function newPhone(
  context: BrowserContext,
  url: string,
): Promise<{ page: Page; authenticator: VirtualAuthenticator }> {
  const page = await context.newPage();
  const authenticator = await addVirtualAuthenticator(page);
  await page.goto(url, { waitUntil: "load" });
  return { page, authenticator };
}
