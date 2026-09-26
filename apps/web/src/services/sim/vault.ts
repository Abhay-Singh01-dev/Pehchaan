// The simulation's key vault (SIM_KEY only): one IndexedDB database shared by every tab of this browser, holding
// the software passkeys of simulated phones. It lets the Simulation panel's "Auto-answer" (one-device testing)
// sign a GENUINE answer as the family member being checked, so simulation runs the one real verifier (D-008).
// It never exists outside simulation builds.
import Dexie, { type Table } from "dexie";

export interface VaultCred {
  credId: string;
  deviceId: string;
  publicKey: string;
  privateKey: CryptoKey;
}

class SimVault extends Dexie {
  creds!: Table<VaultCred, string>;
  constructor() {
    super("pehchaan-sim-vault");
    this.version(1).stores({ creds: "credId, deviceId" });
  }
}

let vault: SimVault | null = null;
const open = () => (vault ??= new SimVault());

export const putVaultCred = (c: VaultCred) => open().creds.put(c);
export const getVaultCred = (credId: string) => open().creds.get(credId);
export const deleteVaultCred = (credId: string) => open().creds.delete(credId);
