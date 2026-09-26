// Prints a new VAPID key pair and key ID for ONE environment (spec 11.1, 11.9, 18.7):
//   pnpm tsx infra/scripts/vapid-keys.ts [key-id]
// Put VAPID_PUBLIC_KEY, VAPID_KEY_ID and VAPID_PRIVATE_KEY in that relay's .env, and the same public key and ID in
// the app's build settings (VITE_VAPID_PUBLIC_KEY, VITE_VAPID_KEY_ID). Environments never share keys. The private
// key is a secret: it is printed once, to this terminal only, and never written to disk by this script.
import { createECDH } from "node:crypto";

const keyId = process.argv[2] ?? `v${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
if (!/^[A-Za-z0-9_.-]{1,32}$/.test(keyId)) {
  console.error("The key ID may use letters, digits, '_', '.' and '-' (at most 32 characters).");
  process.exit(1);
}

// A P-256 key pair in the format Web Push uses: the public key as 65 raw bytes (uncompressed point), the private
// key as its 32-byte scalar, both base64url without padding.
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const publicKey = ecdh.getPublicKey().toString("base64url");
// The scalar can have leading zero bytes, which Node drops: always write all 32.
const scalar = ecdh.getPrivateKey();
const privateKey = Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]).toString("base64url");

console.log(`# Relay (.env on the VM; the private key is a secret)
VAPID_KEY_ID=${keyId}
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}

# App build settings (public)
VITE_VAPID_KEY_ID=${keyId}
VITE_VAPID_PUBLIC_KEY=${publicKey}`);
