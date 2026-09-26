// Bridges SimKey.signAnswer to the simulated unlock sheet (F2, simulation build).
// signAnswer awaits requestUnlock(); the sheet (components/UnlockSheet) resolves or rejects it.
import { create } from "zustand";
import type { Decision, VerifyRequest } from "../types";
import { KeyError } from "../errors";

export interface UnlockRequest {
  id: number;
  req: VerifyRequest;
  decision: Decision;
  resolve: () => void;
  reject: (e: KeyError) => void;
}

interface UnlockState {
  pending: UnlockRequest | null;
}

export const useUnlockBridge = create<UnlockState>(() => ({ pending: null }));

let seq = 0;

export function requestUnlock(req: VerifyRequest, decision: Decision): Promise<void> {
  // A newer prompt replaces an older one (the older is treated as cancelled).
  const prev = useUnlockBridge.getState().pending;
  if (prev) prev.reject(new KeyError("cancelled"));
  return new Promise<void>((resolve, reject) => {
    const id = ++seq;
    const done = () => {
      if (useUnlockBridge.getState().pending?.id === id) useUnlockBridge.setState({ pending: null });
    };
    useUnlockBridge.setState({
      pending: {
        id,
        req,
        decision,
        resolve: () => {
          done();
          resolve();
        },
        reject: (e) => {
          done();
          reject(e);
        },
      },
    });
  });
}

/** Cancels an open prompt (e.g. the request expired while the sheet was up). */
export function cancelUnlock() {
  useUnlockBridge.getState().pending?.reject(new KeyError("cancelled"));
}
