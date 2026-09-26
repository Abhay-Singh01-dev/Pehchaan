// Sounds (spec B7), synthesised with the Web Audio API: no audio files.
//
// Browsers only let audio start after a user gesture. Constructing an AudioContext can
// block the main thread for a few hundred ms on slow phones, so it is created during idle
// time after launch (suspended), and merely resumed on the first tap anywhere.

type Voice = { freq: number; at: number; len: number; gain?: number; type?: OscillatorType };

let ctx: AudioContext | null = null;
let enabled = true;

const NOTE = {
  A3: 220,
  G4: 392,
  C5: 523.25,
  E5: 659.25,
  B5: 987.77,
} as const;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    typeof window !== "undefined"
      ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  try {
    ctx = new Ctor({ latencyHint: "interactive" });
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call once at startup. Warms the context when idle and resumes it on the first gesture. */
export function installAudioUnlock() {
  if (typeof window === "undefined") return;
  const warm = () => getCtx();
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (idle) idle(warm, { timeout: 4000 });
  else window.setTimeout(warm, 1500);

  const unlock = () => {
    const c = getCtx();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

export function setSoundsEnabled(on: boolean) {
  enabled = on;
}

function play(voices: Voice[]) {
  if (!enabled) return;
  const c = getCtx();
  if (!c || c.state !== "running") return;
  const t0 = c.currentTime + 0.01;
  const master = c.createGain();
  master.gain.value = 0.9;
  master.connect(c.destination);
  for (const v of voices) {
    const start = t0 + v.at;
    const peak = v.gain ?? 0.18;
    // Soft body: a sine, plus a quiet triangle an octave up for a little shimmer.
    const layers: Array<[OscillatorType, number, number]> = [
      [v.type ?? "sine", v.freq, peak],
      ["triangle", v.freq * 2, peak * 0.12],
    ];
    for (const [type, freq, g] of layers) {
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(g, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, start + v.len);
      osc.connect(env).connect(master);
      osc.start(start);
      osc.stop(start + v.len + 0.05);
    }
  }
}

export const sounds = {
  /** Two-note soft chime E5 → B5, 160 ms each. */
  incoming: () =>
    play([
      { freq: NOTE.E5, at: 0, len: 0.2 },
      { freq: NOTE.B5, at: 0.16, len: 0.32 },
    ]),
  /** A gentle rising major third, C5 → E5. */
  confirmed: () =>
    play([
      { freq: NOTE.C5, at: 0, len: 0.28, gain: 0.16 },
      { freq: NOTE.E5, at: 0.14, len: 0.5, gain: 0.16 },
    ]),
  /** Two low notes, firm but not alarming. */
  denied: () =>
    play([
      { freq: NOTE.A3, at: 0, len: 0.22, gain: 0.26 },
      { freq: NOTE.A3, at: 0.26, len: 0.36, gain: 0.26 },
    ]),
  /** A single mid note. */
  amber: () => play([{ freq: NOTE.G4, at: 0, len: 0.42, gain: 0.18 }]),
};

/** Repeats the incoming chime every 2 s until stopped. */
export function soundLoop(fn: () => void, everyMs = 2000): () => void {
  fn();
  const id = window.setInterval(fn, everyMs);
  return () => window.clearInterval(id);
}
