// J2 · Call Guard (spec B12 J2, B6.5). A laptop page that listens to a call on speakerphone and
// suggests a check to the parent's phone. It never decides anything: the parent still taps.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { CaretDown, Microphone, PaperPlaneTilt, Play, Stop, SkipForward, Waveform as WaveIcon, DeviceMobile } from "@phosphor-icons/react";
import { loadGuard, services } from "@/services";
import type { GuardService, GuardSignals, Tactic } from "@/services/types";
import { GuardError } from "@/services/errors";
import { AMOUNT_PATTERNS, IDENTITY_PATTERNS, TACTIC_RULES, analyzeLine } from "@/services/guard/rules";
import { Button } from "@/components/Button";
import { Segmented, Switch } from "@/components/controls";
import { useFamily } from "@/store/family";
import { useProfile } from "@/store/profile";
import { connectRelay } from "@/app/bootstrap";
import { useSession, useReduced } from "@/app/session";
import { toast } from "@/app/ui";
import { useG } from "@/app/i18n";
import { formatClock, formatINR } from "@/lib/format";
import { dur, ease, spring } from "@/design/motion";
import { cn } from "@/lib/cn";
import { LaptopHeader, LaptopNarrowNote } from "../lab/LaptopShell";
import { WaveformCanvas } from "./Waveform";

type Line = { id: number; text: string; final: boolean };

function Highlighted({ text, names }: { text: string; names: string[] }) {
  const matches = useMemo(() => analyzeLine(text, names).matches.filter((m) => m.length > 1), [text, names]);
  if (!matches.length) return <>{text}</>;
  const escaped = matches.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  // split() with a capturing group returns the matched parts; compare them by value (no
  // stateful .test() on a global regex).
  const isMatch = (s: string) => matches.some((mm) => mm.toLowerCase() === s.toLowerCase());
  return (
    <>
      {text.split(re).map((part, i) =>
        isMatch(part) ? (
          <mark key={i} className="rounded-md bg-brand-soft px-1 text-brand-ink">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function TypedWords({ text }: { text: string }) {
  const reduced = useReduced();
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <m.span
          key={i}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </m.span>
      ))}
    </>
  );
}

export function Guard() {
  const { t } = useG();
  const reduced = useReduced();
  const family = useFamily();
  const profile = useProfile();
  const peers = useSession((s) => s.peers);
  const [guard, setGuard] = useState<GuardService | null>(null);
  const [mode, setMode] = useState<"scripted" | "microphone">("scripted");
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [signals, setSignals] = useState<GuardSignals>({ tactics: [], stage: 0 });
  const [target, setTarget] = useState<string>("");
  const [autoSend, setAutoSend] = useState(true);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [micError, setMicError] = useState<"unsupported" | "denied" | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [flying, setFlying] = useState(0);
  const lineSeq = useRef(0);
  const autoSent = useRef(false);

  // Connect to the relay as a Call Guard (so it can send prompts), and load the guard service.
  useEffect(() => {
    const off = connectRelay();
    services.relay.announce({ name: "Call Guard", kind: "guard" });
    void loadGuard().then(setGuard);
    return () => {
      off();
    };
  }, []);

  // Names to listen for: family labels and names on this device + everyone on the relay.
  const names = useMemo(() => {
    const out = new Set<string>();
    family?.forEach((mm) => {
      out.add(mm.label);
      out.add(mm.name.split(/\s+/)[0]!);
    });
    peers.forEach((p) => p.name && p.kind === "phone" && out.add(p.name.split(/\s+/)[0]!));
    if (profile?.name) out.add(profile.name.split(/\s+/)[0]!);
    return [...out].filter(Boolean);
  }, [family, peers, profile]);

  useEffect(() => {
    guard?.setNames(names);
  }, [guard, names]);

  const phones = peers.filter((p) => p.kind === "phone");
  useEffect(() => {
    if (!target || !phones.some((p) => p.deviceId === target)) {
      const pick = phones.find((p) => !p.canBeVerified) ?? phones[0];
      if (pick) setTarget(pick.deviceId);
    }
  }, [phones, target]);

  useEffect(() => {
    if (!guard) return;
    const offT = guard.onTranscript((l) => {
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last && !last.final) {
          const next = [...prev];
          next[next.length - 1] = { ...last, text: l.text, final: l.final };
          return next;
        }
        return [...prev, { id: ++lineSeq.current, text: l.text, final: l.final }].slice(-30);
      });
    });
    const offS = guard.onSignals(setSignals);
    return () => {
      offT();
      offS();
    };
  }, [guard]);

  const targetPeer = phones.find((p) => p.deviceId === target);
  const targetName = targetPeer?.name?.split(/\s+/)[0] ?? t("lab.fallbackAsker");

  const send = useCallback(async () => {
    if (!target) return;
    try {
      await services.relay.sendGuardPrompt(
        { claimedLabel: signals.claimedLabel ?? "", amountInr: signals.amountInr, tactics: signals.tactics, at: Date.now() },
        target,
      );
      setSentAt(Date.now());
      setFlying((n) => n + 1);
    } catch {
      toast(t("conn.offline"), { tone: "error" });
    }
  }, [target, signals, t]);

  // Auto-send once there's an identity claim and the stage reaches Money.
  useEffect(() => {
    if (!autoSend || autoSent.current || !running) return;
    if (signals.claimedLabel && signals.stage >= 4) {
      autoSent.current = true;
      void send();
    }
  }, [signals, autoSend, running, send]);

  const start = async () => {
    if (!guard) return;
    setLines([]);
    setSentAt(null);
    autoSent.current = false;
    setMicError(null);
    try {
      await guard.start(mode);
      setRunning(true);
    } catch (e) {
      if (e instanceof GuardError) setMicError(e.code === "mic_denied" ? "denied" : "unsupported");
    }
  };
  const stop = () => {
    guard?.stop();
    setRunning(false);
  };
  useEffect(() => () => guard?.stop(), [guard]);

  const subscribeLevel = useCallback((cb: (l: number) => void) => (guard ? guard.onLevel(cb) : () => {}), [guard]);

  const TACTICS: Tactic[] = ["identity", "money", "urgency", "secrecy", "otp", "authority"];

  return (
    <div className="frame-bg min-h-app">
      <LaptopHeader title={t("guard.title")}>
        <span
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-full px-3 text-caption font-semibold",
            running ? "bg-brand-soft text-brand-ink" : "bg-surface-2 text-muted",
          )}
          role="status"
        >
          <span className={cn("h-2 w-2 rounded-full", running ? "bg-brand" : "bg-muted")} style={running && !reduced ? { animation: "dots 1.2s infinite" } : undefined} />
          {running ? t("guard.listening") : t("guard.paused")}
        </span>
        <Segmented
          id="guard-mode"
          className="w-[250px]"
          label={t("guard.mode")}
          value={mode}
          onChange={(v) => {
            if (running) stop();
            setMode(v);
          }}
          options={[
            { value: "microphone", label: t("guard.microphone") },
            { value: "scripted", label: t("guard.scripted") },
          ]}
        />
        <label className="flex items-center gap-2 text-body-sm text-ink-2">
          {t("guard.sendTo")}
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-10 rounded-full bg-surface-2 px-3 text-body-sm font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none"
          >
            {phones.length === 0 && <option value="">{t("guard.noDevices")}</option>}
            {phones.map((p) => (
              <option key={p.deviceId} value={p.deviceId}>
                {t("lab.asker", { name: p.name?.split(/\s+/)[0] || p.deviceId })}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <Button size="md" variant="danger-outline" icon={<Stop size={18} weight="fill" />} onClick={stop}>
            {t("guard.stop")}
          </Button>
        ) : (
          <Button size="md" icon={<Play size={18} weight="fill" />} onClick={start} disabled={!guard}>
            {t("guard.start")}
          </Button>
        )}
      </LaptopHeader>
      <LaptopNarrowNote text={t("guard.wide")} />

      <main className="mx-auto grid max-w-[1280px] gap-6 px-6 py-6 lg:grid-cols-[1.5fr_1fr] lg:px-8">
        {/* Left: waveform + transcript */}
        <section className="flex flex-col gap-4">
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.06em] text-muted">
                <WaveIcon size={16} /> {t("guard.waveform")}
              </h2>
              {running && mode === "scripted" && (
                <Button size="sm" variant="ghost" icon={<SkipForward size={16} />} onClick={() => guard?.next()}>
                  {t("guard.nextLine")}
                </Button>
              )}
            </div>
            <WaveformCanvas subscribe={subscribeLevel} active={running} />
          </div>

          {micError && (
            <div className="card flex flex-wrap items-center gap-3 p-4" role="alert">
              <Microphone size={24} weight="duotone" className="text-chip-amber" aria-hidden />
              <p className="flex-1 text-body font-medium text-ink">{micError === "denied" ? t("guard.micDenied") : t("guard.micUnsupported")}</p>
              <Button size="md" variant="secondary" onClick={() => { setMode("scripted"); setMicError(null); }}>
                {t("guard.useScripted")}
              </Button>
            </div>
          )}

          <div className="card min-h-[340px] p-5">
            <h2 className="mb-3 text-caption font-semibold uppercase tracking-[0.06em] text-muted">{t("guard.transcript")}</h2>
            {lines.length === 0 ? (
              <p className="text-body text-muted">{t("guard.transcriptEmpty")}</p>
            ) : (
              <ol className="flex flex-col gap-2.5" aria-live="polite">
                {lines.map((l) => (
                  <m.li
                    key={l.id}
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: l.final ? 1 : 0.7, y: 0 }}
                    transition={{ duration: dur.base, ease: ease.out }}
                    className={cn("rounded-[14px] px-4 py-2.5 text-body", l.final ? "bg-surface-2 text-ink" : "text-ink-2")}
                  >
                    {l.final ? <Highlighted text={l.text} names={names} /> : <TypedWords text={l.text} />}
                  </m.li>
                ))}
              </ol>
            )}
          </div>
        </section>

        {/* Right: signals, stage, prompt */}
        <section className="flex flex-col gap-4">
          <div className="card p-5">
            <h2 className="mb-3 text-caption font-semibold uppercase tracking-[0.06em] text-muted">{t("guard.hearing")}</h2>
            <div className="flex min-h-10 flex-wrap gap-2">
              {signals.tactics.length === 0 && <span className="text-body-sm text-muted">{t("guard.nothing")}</span>}
              <AnimatePresence>
                {TACTICS.filter((x) => signals.tactics.includes(x)).map((x) => (
                  <m.span
                    key={x}
                    layout
                    initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={spring.ui}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full px-3.5 text-body-sm font-semibold",
                      x === "identity" || x === "money" ? "bg-brand text-on-brand" : "bg-brand-soft text-brand-ink",
                    )}
                  >
                    {x === "identity" && signals.claimedLabel
                      ? t("guard.identity", { name: signals.claimedLabel })
                      : x === "money" && signals.amountInr
                        ? t("guard.money", { amount: formatINR(signals.amountInr) })
                        : t(`tactic.${x}`)}
                  </m.span>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="mb-3 text-caption font-semibold uppercase tracking-[0.06em] text-muted">{t("guard.stage")}</h2>
            <div className="grid grid-cols-5 gap-1.5">
              {[0, 1, 2, 3, 4].map((s) => (
                <div key={s} className="flex flex-col gap-1.5">
                  <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                    <m.div
                      className="h-full w-full origin-left rounded-full bg-brand"
                      initial={false}
                      animate={{ scaleX: signals.stage >= s && (s > 0 || running) ? 1 : 0 }}
                      transition={{ duration: 0.4, delay: reduced ? 0 : s * 0.12, ease: ease.out }}
                    />
                  </div>
                  <span className={cn("text-caption font-semibold", signals.stage >= s ? "text-ink" : "text-muted")}>
                    {t(`guard.stages.${s}`)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card relative overflow-hidden p-5">
            <h2 className="mb-3 text-caption font-semibold uppercase tracking-[0.06em] text-muted">{t("guard.prompt")}</h2>
            <Button
              full
              icon={<PaperPlaneTilt size={20} weight="fill" />}
              disabled={!target || !signals.claimedLabel}
              onClick={() => void send()}
            >
              {target ? t("guard.send", { name: targetName }) : t("guard.sendGeneric")}
            </Button>
            {!signals.claimedLabel && <p className="mt-2 text-caption text-muted">{t("guard.needClaim")}</p>}
            <label className="mt-4 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-body font-medium text-ink">{t("guard.autoSend")}</p>
                <p className="text-caption text-muted">{t("guard.autoSendHint")}</p>
              </div>
              <Switch checked={autoSend} label={t("guard.autoSend")} onChange={setAutoSend} />
            </label>
            <AnimatePresence>
              {sentAt && (
                <m.p
                  key={sentAt}
                  className="mt-3 flex items-center gap-2 text-body-sm font-semibold text-brand-ink"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="status"
                >
                  <DeviceMobile size={18} /> {t("guard.sent", { time: formatClock(sentAt) })}
                </m.p>
              )}
            </AnimatePresence>
            {/* The prompt flies from the page toward the phone. */}
            <AnimatePresence>
              {flying > 0 && !reduced && (
                <m.span
                  key={flying}
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-16 inline-flex h-8 items-center gap-1.5 rounded-full bg-brand px-3 font-mono text-caption font-semibold text-on-brand"
                  initial={{ x: "-50%", y: 0, opacity: 1, scale: 1 }}
                  animate={{ x: ["-50%", "40%", "140%"], y: [0, -40, -90], opacity: [1, 1, 0], scale: [1, 0.8, 0.5] }}
                  transition={{ duration: 0.9, ease: ease.inOut }}
                >
                  <PaperPlaneTilt size={14} weight="fill" /> {signals.claimedLabel}
                </m.span>
              )}
            </AnimatePresence>
          </div>

          {/* Rules drawer: every rule, in plain text. */}
          <div className="card overflow-hidden">
            <button
              type="button"
              onClick={() => setRulesOpen((v) => !v)}
              aria-expanded={rulesOpen}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <span>
                <span className="block font-display text-h3 font-semibold text-ink">{t("guard.rules")}</span>
                <span className="block text-caption text-muted">{t("guard.rulesHint")}</span>
              </span>
              <m.span animate={{ rotate: rulesOpen ? 180 : 0 }} transition={spring.ui}>
                <CaretDown size={20} className="text-muted" />
              </m.span>
            </button>
            <AnimatePresence initial={false}>
              {rulesOpen && (
                <m.div
                  className="border-t border-line px-5 py-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: dur.base }}
                >
                  <dl className="flex flex-col gap-3 text-body-sm">
                    <div>
                      <dt className="font-semibold text-ink">{t("guard.identityRules")}</dt>
                      <dd className="mt-0.5 font-mono text-caption text-ink-2">
                        {[...IDENTITY_PATTERNS.latin, ...IDENTITY_PATTERNS.devanagari, ...IDENTITY_PATTERNS.generic, ...IDENTITY_PATTERNS.anyName]
                          .map((p) => `“${p}”`)
                          .join(" · ")}
                      </dd>
                    </div>
                    {TACTIC_RULES.map((r) => (
                      <div key={r.tactic}>
                        <dt className="font-semibold text-ink">{t(`tactic.${r.tactic}`)}</dt>
                        <dd className="mt-0.5 font-mono text-caption text-ink-2">
                          {[...r.latin, ...r.devanagari, ...(r.exact ?? [])].map((p) => `“${p}”`).join(" · ")}
                        </dd>
                      </div>
                    ))}
                    <div>
                      <dt className="font-semibold text-ink">{t("guard.amountRules")}</dt>
                      <dd className="mt-0.5 text-caption text-ink-2">{AMOUNT_PATTERNS.join(" · ")}</dd>
                    </div>
                  </dl>
                </m.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        <p className="text-center text-body-sm font-medium text-muted lg:col-span-2">{t("guard.footer")}</p>
      </main>
    </div>
  );
}
