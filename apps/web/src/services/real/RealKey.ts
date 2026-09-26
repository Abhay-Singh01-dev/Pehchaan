// RealKey (backend spec 10.3, 10.4, FC-4, FC-24): the answer key is a passkey (WebAuthn, ES256) on this phone,
// bound to the rpId, and every signature needs the phone's own unlock (user verification required).
//
// Safari's rule: the passkey prompt must start inside the user's tap, and an `await` before
// navigator.credentials.get() can lose that permission. So both challenges are computed when F1 opens
// (prepareAnswer), and signAnswer() calls get() before awaiting anything.
import { b64url, b64urlDecode } from "@pehchaan/crypto/bytes";
import { challengeFor } from "@pehchaan/crypto/canonical";
import { appConfig } from "@/app/config";
import type { Decision, KeyService, Profile, VerifyRequest, WireAnswer } from "../types";
import { KeyError } from "../errors";

export interface RealKeyDeps {
  getProfile: () => Promise<Profile | null>;
  /** WebAuthn entry points (the browser's by default; tests use a virtual authenticator instead). */
  credentials?: CredentialsContainer;
}

interface Prepared {
  requestId: string;
  credId: string;
  challenges: Record<Decision, Uint8Array<ArrayBuffer>>;
  timeoutMs: number;
}

/** Maps a WebAuthn DOMException to the A6/F5 states (10.3). */
export function keyErrorFrom(e: unknown): KeyError {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return new KeyError("cancelled");
  if (name === "NotSupportedError") return new KeyError("no_passkeys");
  if (e instanceof KeyError) return e;
  // SecurityError (wrong rpId or insecure origin), InvalidStateError and anything else: a configuration or
  // platform problem, not something the person did.
  return new KeyError("failed");
}

export function createRealKey(deps: RealKeyDeps): KeyService {
  const creds = () => deps.credentials ?? navigator.credentials;
  let prepared: Prepared | null = null;

  return {
    async checkSupport() {
      const pkc = typeof PublicKeyCredential === "undefined" ? undefined : PublicKeyCredential;
      if (!pkc?.isUserVerifyingPlatformAuthenticatorAvailable) return { passkeys: false, screenLock: "unknown" };
      const ok = await pkc.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
      // A screen lock can't be detected separately; a user-verifying authenticator implies one.
      return { passkeys: ok, screenLock: ok ? "yes" : "unknown" };
    },

    async createKey({ deviceId, name }) {
      let cred: PublicKeyCredential;
      try {
        cred = (await creds().create({
          publicKey: {
            rp: { id: appConfig.rpId, name: "Pehchaan" },
            user: { id: new TextEncoder().encode(deviceId), name: `${name} · Pehchaan`, displayName: name },
            // No server: the key's authenticity comes from the safety words compared face to face.
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 only
            authenticatorSelection: {
              authenticatorAttachment: "platform",
              residentKey: "preferred",
              userVerification: "required",
            },
            attestation: "none",
            timeout: 120_000,
            // Newer browsers: prefer this phone's own authenticator; ignored elsewhere.
            ...({ hints: ["client-device"] } as object),
          },
        })) as PublicKeyCredential;
      } catch (e) {
        throw keyErrorFrom(e);
      }
      const res = cred.response as AuthenticatorAttestationResponse;
      if (res.getPublicKeyAlgorithm() !== -7) throw new KeyError("failed");
      const spki = res.getPublicKey();
      if (!spki) throw new KeyError("failed");
      const ad = new Uint8Array(res.getAuthenticatorData());
      // A real unlock must have happened (UV flag).
      if (!(ad[32]! & 0x04)) throw new KeyError("no_screen_lock");
      const k = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
      return {
        keyId: b64url(new Uint8Array(cred.rawId)),
        publicKey: b64url(new Uint8Array(await crypto.subtle.exportKey("raw", k))),
      };
    },

    async prepareAnswer(req: VerifyRequest, localDeadline?: number) {
      const profile = await deps.getProfile();
      if (!profile?.keyId) {
        prepared = null;
        return;
      }
      prepared = {
        requestId: req.requestId,
        credId: profile.keyId,
        challenges: { ME: await challengeFor(req, "ME"), NOT_ME: await challengeFor(req, "NOT_ME") },
        timeoutMs: Math.max(5000, (localDeadline ?? Date.now() + 60_000) - Date.now()),
      };
    },

    signAnswer(req, decision): Promise<WireAnswer> {
      const p = prepared;
      if (!p || p.requestId !== req.requestId) return Promise.reject(new KeyError("no_key"));
      // Nothing is awaited before get(): the prompt starts inside the tap.
      const pending = creds().get({
        publicKey: {
          challenge: p.challenges[decision],
          rpId: appConfig.rpId,
          allowCredentials: [{ type: "public-key", id: b64urlDecode(p.credId), transports: ["internal"] }],
          userVerification: "required",
          timeout: p.timeoutMs,
        },
      }) as Promise<PublicKeyCredential | null>;
      return pending.then(
        (cred) => {
          if (!cred) throw new KeyError("cancelled");
          const a = cred.response as AuthenticatorAssertionResponse;
          return {
            requestId: req.requestId,
            nonce: req.nonce,
            decision,
            keyType: "pk" as const,
            credId: b64url(new Uint8Array(cred.rawId)),
            authenticatorData: b64url(new Uint8Array(a.authenticatorData)),
            clientDataJSON: b64url(new Uint8Array(a.clientDataJSON)),
            signature: b64url(new Uint8Array(a.signature)), // ASN.1 DER, as WebAuthn returns it
            answeredAt: Date.now(),
          };
        },
        (e) => {
          throw keyErrorFrom(e);
        },
      );
    },

    async deleteKey() {
      // JavaScript can't delete a passkey. Where supported (Chrome 132+), tell the password manager it's
      // orphaned so it can hide it (5.4); otherwise Settings tells the person where to delete it.
      const profile = await deps.getProfile();
      const pkc = (typeof PublicKeyCredential === "undefined" ? undefined : PublicKeyCredential) as
        | (typeof PublicKeyCredential & {
            signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>;
          })
        | undefined;
      if (profile?.keyId && pkc?.signalUnknownCredential) {
        await pkc.signalUnknownCredential({ rpId: appConfig.rpId, credentialId: profile.keyId }).catch(() => {});
      }
      prepared = null;
    },
  };
}
