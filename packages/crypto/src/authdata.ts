// WebAuthn authenticatorData (spec 10.5 checks 4 and 5):
//   bytes 0–31  rpIdHash = SHA-256(rpId)
//   byte  32    flags: bit 0 UP (user present), bit 2 UV (user verified: fingerprint, face or PIN)
//   bytes 33–36 signCount (ignored: synced passkeys report 0, 10.4)
// Anything shorter than 37 bytes isn't authenticatorData.

export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const AUTH_DATA_MIN = 37;

export interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  up: boolean;
  uv: boolean;
  signCount: number;
}

export function parseAuthData(ad: Uint8Array): AuthData {
  if (ad.length < AUTH_DATA_MIN) throw new Error("authenticatorData too short");
  const flags = ad[32]!;
  return {
    rpIdHash: ad.subarray(0, 32),
    flags,
    up: (flags & FLAG_UP) !== 0,
    uv: (flags & FLAG_UV) !== 0,
    signCount: ((ad[33]! << 24) | (ad[34]! << 16) | (ad[35]! << 8) | ad[36]!) >>> 0,
  };
}
