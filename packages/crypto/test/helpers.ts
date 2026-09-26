// Test helpers: real WebCrypto keys for devices (never mocked).
import { b64url } from "../src/bytes";
import { deviceIdFrom } from "../src/device-auth";

export interface TestDevice {
  deviceId: string;
  sign: CryptoKeyPair;
  enc: CryptoKeyPair;
  dk: string;
  ek: string;
  ekRaw: Uint8Array;
}

export async function makeDevice(): Promise<TestDevice> {
  const sign = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const enc = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const dkRaw = new Uint8Array(await crypto.subtle.exportKey("raw", sign.publicKey));
  const ekRaw = new Uint8Array(await crypto.subtle.exportKey("raw", enc.publicKey));
  return { deviceId: await deviceIdFrom(dkRaw), sign, enc, dk: b64url(dkRaw), ek: b64url(ekRaw), ekRaw };
}

export const ulidLike = () => "01JB7Y8Q3Z6N4V5W2K9C0D1E" + String(Math.floor(Math.random() * 90) + 10);
