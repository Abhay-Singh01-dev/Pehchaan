// SimGuard (spec B3 item 6): listens to a call and reports signals. It never decides anything.
//   - scripted: plays the six call lines at realistic timing, word by word
//   - microphone: Web Speech API (webkitSpeechRecognition, hi-IN, interim results) where
//     available; otherwise start() throws GuardError('mic_unsupported') and the page offers
//     scripted mode.
import type { GuardService, GuardSignals, Unsubscribe } from "../types";
import { GuardError } from "../errors";
import { accumulate, analyzeLine, SCRIPTED_CALL } from "../guard/rules";

type Listener<T> = (v: T) => void;
type TranscriptLine = { text: string; final: boolean; at: number };

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class SimGuard implements GuardService {
  private names: string[] = [];
  private signals: GuardSignals = { tactics: [], stage: 0 };
  private running: "microphone" | "scripted" | null = null;
  private lineIndex = 0;
  private timers: number[] = [];
  private speaking = false;
  private levelRaf = 0;
  private levelPhase = 0;
  private rec: SpeechRecognitionLike | null = null;
  private media: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private advance: (() => void) | null = null;

  private ls = {
    transcript: new Set<Listener<TranscriptLine>>(),
    signals: new Set<Listener<GuardSignals>>(),
    level: new Set<Listener<number>>(),
  };

  setNames(names: string[]): void {
    this.names = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  }

  micSupported(): boolean {
    return speechCtor() !== null;
  }

  async start(mode: "microphone" | "scripted"): Promise<void> {
    this.stop();
    this.signals = { tactics: [], stage: 0 };
    this.emitSignals();
    if (mode === "microphone") await this.startMic();
    else this.startScript();
    this.running = mode;
    this.loopLevel();
  }

  stop(): void {
    this.running = null;
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    this.advance = null;
    this.speaking = false;
    cancelAnimationFrame(this.levelRaf);
    this.emitLevel(0);
    if (this.rec) {
      this.rec.onend = null;
      try {
        this.rec.stop();
      } catch {
        /* ignore */
      }
      this.rec = null;
    }
    this.media?.getTracks().forEach((t) => t.stop());
    this.media = null;
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.analyser = null;
  }

  next(): void {
    if (this.running !== "scripted") return;
    this.advance?.();
  }

  // ─── Scripted mode ───────────────────────────────────────────────────────

  private startScript() {
    this.lineIndex = 0;
    this.scheduleLine(900);
  }

  private scheduleLine(delay: number) {
    if (this.lineIndex >= SCRIPTED_CALL.length) {
      this.advance = null;
      return;
    }
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      window.clearTimeout(timer);
      this.speakLine(SCRIPTED_CALL[this.lineIndex++]!);
    };
    const timer = window.setTimeout(fire, delay);
    this.timers.push(timer);
    this.advance = fire;
  }

  private speakLine(line: string) {
    const words = line.split(" ");
    const at = Date.now();
    this.speaking = true;
    let i = 0;
    const step = () => {
      i++;
      const text = words.slice(0, i).join(" ");
      const final = i >= words.length;
      this.ls.transcript.forEach((cb) => cb({ text, final, at }));
      if (final) {
        this.speaking = false;
        this.ingest(line);
        // 3–5 s between lines (including this line's speaking time).
        this.scheduleLine(1400 + Math.random() * 1600);
        return;
      }
      this.timers.push(window.setTimeout(step, 150 + Math.random() * 120));
    };
    step();
    // While a line is being spoken, "Next line" skips the pause after it.
    this.advance = () => {
      /* the next line is scheduled when this one finishes */
    };
  }

  // ─── Microphone mode ─────────────────────────────────────────────────────

  private async startMic() {
    const Ctor = speechCtor();
    if (!Ctor) throw new GuardError("mic_unsupported");
    // Microphone level for the waveform (optional; recognition works without it).
    try {
      this.media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } });
      this.audioCtx = new AudioContext();
      const src = this.audioCtx.createMediaStreamSource(this.media);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
    } catch (e) {
      if ((e as DOMException)?.name === "NotAllowedError") throw new GuardError("mic_denied");
    }
    const rec = new Ctor();
    rec.lang = "hi-IN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const text = r[0].transcript.trim();
        if (!text) continue;
        this.ls.transcript.forEach((cb) => cb({ text, final: r.isFinal, at: Date.now() }));
        if (r.isFinal) this.ingest(text);
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") this.stop();
    };
    // Chrome ends continuous recognition after silence; keep listening while running.
    rec.onend = () => {
      if (this.running === "microphone") {
        try {
          rec.start();
        } catch {
          /* ignore */
        }
      }
    };
    rec.start();
    this.rec = rec;
  }

  // ─── Signals and level ───────────────────────────────────────────────────

  private ingest(line: string) {
    this.signals = accumulate(this.signals, analyzeLine(line, this.names));
    this.emitSignals();
  }

  private emitSignals() {
    const s = this.signals;
    this.ls.signals.forEach((cb) => cb(s));
  }

  private emitLevel(v: number) {
    this.ls.level.forEach((cb) => cb(v));
  }

  private loopLevel() {
    let last = 0;
    const buf = new Uint8Array(512);
    const tick = (t: number) => {
      if (!this.running) return;
      this.levelRaf = requestAnimationFrame(tick);
      if (t - last < 33) return; // ~30 fps
      last = t;
      let level: number;
      if (this.analyser) {
        this.analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i]! - 128) / 128;
          sum += v * v;
        }
        level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      } else {
        // Scripted speech: a smooth, syllable-like envelope while a line is spoken.
        this.levelPhase += 0.33;
        const syllables = (Math.sin(this.levelPhase) + Math.sin(this.levelPhase * 2.7 + 1) * 0.5 + 1.5) / 3;
        level = this.speaking ? 0.25 + syllables * 0.7 * (0.75 + Math.random() * 0.25) : 0.04 + Math.random() * 0.03;
      }
      this.emitLevel(level);
    };
    this.levelRaf = requestAnimationFrame(tick);
  }

  onTranscript(cb: (line: TranscriptLine) => void): Unsubscribe {
    this.ls.transcript.add(cb);
    return () => this.ls.transcript.delete(cb);
  }

  onSignals(cb: (s: GuardSignals) => void): Unsubscribe {
    this.ls.signals.add(cb);
    cb(this.signals);
    return () => this.ls.signals.delete(cb);
  }

  onLevel(cb: (level: number) => void): Unsubscribe {
    this.ls.level.add(cb);
    return () => this.ls.level.delete(cb);
  }
}
