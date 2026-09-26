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
  /** Everything needed to put the same passkeys on another page's authenticator (the phone keeps its passkeys
   *  when its app is closed and opened again; a virtual authenticator lives only as long as its page). */
  exportCredentials(): Promise<StoredCredential[]>;
  importCredentials(creds: StoredCredential[]): Promise<void>;
  /** The passkey is deleted from the password manager (spec 23). */
  clearCredentials(): Promise<void>;
  remove(): Promise<void>;
}

export interface StoredCredential {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
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
    async exportCredentials() {
      const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
      return credentials as StoredCredential[];
    },
    async importCredentials(creds) {
      // The sign count carries over, as it would on the same phone.
      for (const credential of creds) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
    },
    async clearCredentials() {
      await cdp.send("WebAuthn.clearCredentials", { authenticatorId });
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
