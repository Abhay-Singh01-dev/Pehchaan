// F1 · Incoming request (spec B12 F1, B6.4 #10), with F4 (expired) and F5 (couldn't confirm).
// Opens automatically from any screen as a takeover. Deep ink in both themes, so it feels
// urgent and distinct from verdicts. The safest answer, NO, NOT ME, sits in the most reachable
// spot. Answering always needs an unlock (F2), including for NO, NOT ME.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Fingerprint, HourglassLow, Stack, WarningCircle, WifiSlash } from "@phosphor-icons/react";
import type { Decision, FamilyMember, VerifyRequest } from "@/services/types";
import { cancelUnlock } from "@/services/sim/unlockBridge";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { CountdownBar, useSecondsLeft } from "@/components/Countdown";
import { SIM_OFFSET } from "@/components/SimulationBadge";
import { useIncoming, usePendingIncoming } from "@/store/requests";
import { useFamily } from "@/store/family";
import { answerRequest, expireIncoming, nextPendingRequestId, type AnswerPhase } from "@/app/answering";
import { useG } from "@/app/i18n";
import { flags } from "@/app/flags";
import { useReduced } from "@/app/session";
import { useWakeLock } from "@/design/wakeLock";
import { hapticLoop } from "@/design/haptics";
import { soundLoop, sounds } from "@/design/sounds";
import { dur, riseIn, spring } from "@/design/motion";
import { formatINR, mmss } from "@/lib/format";
import { cn } from "@/lib/cn";

type UiPhase = "idle" | "unlocking" | "sending" | "retrying" | "cancelled" | "expired" | "no_key";

export function questionKey(req: Pick<VerifyRequest, "reason" | "amountInr">): string {
  switch (req.reason) {
    case "money":
      return req.amountInr ? "ask.q.money" : "ask.q.moneyNoAmount";
    case "otp":
      return "ask.q.otp";
    case "bank_details":
      return "ask.q.bank";
    case "install_app":
      return "ask.q.app";
    default:
      return "ask.q.none";
  }
}

export function Incoming() {
  const { requestId } = useParams();
  const { t, g } = useG();
  const navigate = useNavigate();
  const reduced = useReduced();
  const record = useIncoming(requestId);
  const pending = usePendingIncoming();
  const family = useFamily();
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [chosen, setChosen] = useState<Decision | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const req = record?.request;
  const seconds = useSecondsLeft(req?.expiresAt ?? 0);
  const expired = phase === "expired" || record?.status === "expired" || (req !== undefined && seconds <= 0 && record?.status === "pending");
  const ringing = Boolean(req) && record?.status === "pending" && !expired && (phase === "idle" || phase === "cancelled");

  useWakeLock(Boolean(req) && !expired && record?.status === "pending");

  // Vibration + chime loop until answered or expired (spec B7).
  useEffect(() => {
    if (!ringing) return;
    const stopHaptic = hapticLoop("incoming");
    const stopSound = soundLoop(sounds.incoming, 2000);
    return () => {
      stopHaptic();
      stopSound();
    };
  }, [ringing]);

  // Expiry → F4.
  useEffect(() => {
    if (req && record?.status === "pending" && seconds <= 0) {
      cancelUnlock();
      void expireIncoming(req.requestId);
      setPhase("expired");
    }
  }, [seconds, req, record?.status]);

  // Already answered (e.g. after a reload): show the sent screen.
  useEffect(() => {
    if (record?.status === "answered" && requestId && phase === "idle") navigate(`/request/${requestId}/sent`, { replace: true });
  }, [record?.status, requestId, navigate, phase]);

  const onPhase = useCallback((p: AnswerPhase) => {
    if (!alive.current) return;
    if (p.kind === "sent") return;
    setPhase(p.kind === "sending" ? "sending" : p.kind === "retrying" ? "retrying" : p.kind);
  }, []);

  const answer = async (decision: Decision) => {
    if (!requestId || (phase !== "idle" && phase !== "cancelled")) return;
    setChosen(decision);
    const result = await answerRequest(requestId, decision, onPhase, () => alive.current);
    if (!alive.current) return;
    if (result === "sent") navigate(`/request/${requestId}/sent`, { replace: true });
    if (result === "cancelled") setChosen(null);
  };

  const done = async () => {
    const next = await nextPendingRequestId(requestId);
    navigate(next ? `/request/${next}` : "/home", { replace: true });
  };

  if (record === null) {
    return (
      <div className="v-ink grid min-h-app place-items-center px-6 text-center">
        <div>
          <p className="font-display text-h2 font-semibold">{t("ask.gone")}</p>
          <Button className="mt-6" variant="on-verdict" onClick={() => navigate("/home", { replace: true })}>
            {t("common.done")}
          </Button>
        </div>
      </div>
    );
  }
  if (!record || !req) return <div className="v-ink min-h-app" />;

  const askerMember: FamilyMember | undefined = family?.find((mm) => mm.deviceId === req.fromDeviceId);
  const asker = askerMember?.label ?? req.fromName;
  const more = (pending ?? []).filter((p) => p.requestId !== req.requestId).length;
  const busy = phase === "unlocking" || phase === "sending" || phase === "retrying";

  // The question, with the amount in mono and brighter.
  const qKey = questionKey(req);
  const parts = g(qKey, { amount: "\u0000" }).split("\u0000");

  return (
    <div className="v-ink relative flex min-h-app flex-col overflow-hidden">
      <div
        className="sticky top-0 z-10 mx-auto w-full max-w-[480px] px-5"
        style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET + 6}px)` }}
      >
        {!expired && <CountdownBar expiresAt={req.expiresAt} />}
      </div>

      <div className="relative mx-auto flex w-full max-w-[480px] flex-1 flex-col px-6 pt-6">
        <div className="flex items-center justify-between">
          <span className="text-caption font-semibold uppercase tracking-[0.08em] text-[#8D94BC]">Pehchaan</span>
          {more > 0 && (
            <m.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-caption font-semibold text-[#C3C8E8]"
            >
              <Stack size={16} aria-hidden /> {t("ask.more", { count: more })}
            </m.span>
          )}
        </div>

        <m.div
          className="mt-6 flex flex-col items-center text-center"
          animate={{ opacity: expired ? 0.4 : 1 }}
          transition={{ duration: dur.slow }}
        >
          <Avatar
            name={asker}
            color={askerMember?.color ?? "slate"}
            size={88}
            pulse={ringing ? "heartbeat" : null}
          />
          <m.p className="mt-4 text-body font-semibold text-[#C3C8E8]" {...riseIn(1, reduced, 0.35)}>
            {t("ask.title", { asker })}
          </m.p>
          {!askerMember && (
            <m.div className="mt-2 flex flex-col items-center gap-1" {...riseIn(2, reduced, 0.35)}>
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#FDB022]/15 px-3 text-caption font-semibold text-[#FDB022]">
                <WarningCircle size={16} weight="bold" aria-hidden /> {t("ask.notInList")}
              </span>
              <span className="text-caption text-[#8D94BC]">{t("ask.gaveName", { name: req.fromName })}</span>
            </m.div>
          )}
          <m.h1
            className="mt-6 font-display text-display font-semibold text-white"
            {...riseIn(3, reduced, 0.35)}
          >
            {parts.map((p, i) => (
              <span key={i}>
                {p}
                {i < parts.length - 1 && req.amountInr ? (
                  <span className="whitespace-nowrap font-mono text-[#FDE7B0]">{formatINR(req.amountInr)}</span>
                ) : null}
              </span>
            ))}
          </m.h1>
          {!expired && (
            <p className="mt-4 inline-flex items-center gap-1.5 font-mono text-body font-semibold tabular-nums text-[#C3C8E8]" aria-label={t("a11y.secondsLeft", { count: seconds })}>
              <HourglassLow size={18} aria-hidden /> {t("ask.expires", { time: mmss(seconds) })}
            </p>
          )}
        </m.div>

        <div className="flex-1" />

        <div className="pb-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
          <AnimatePresence mode="wait" initial={false}>
            {expired ? (
              // F4 · Expired
              <m.div
                key="expired"
                className="rounded-[22px] bg-white/[0.08] p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                initial={{ opacity: 0, y: reduced ? 0 : 12 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
              >
                <p className="text-body font-semibold text-white">{t("ask.expired", { asker })}</p>
                <Button className="mt-4" full variant="on-verdict" onClick={done}>
                  {t("common.done")}
                </Button>
              </m.div>
            ) : phase === "no_key" ? (
              <m.div key="nokey" className="rounded-[22px] bg-white/[0.08] p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert">
                <p className="text-body font-semibold text-white">{t("ask.noKey")}</p>
                <Button className="mt-4" full variant="on-verdict" onClick={() => navigate("/settings/key", { replace: true })}>
                  {t("myKey.create")}
                </Button>
              </m.div>
            ) : (
              <m.div key="answer" className="flex flex-col gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {/* Status notes: F5 (couldn't confirm) and "Couldn't send… Reconnecting…" */}
                <AnimatePresence initial={false}>
                  {(phase === "cancelled" || phase === "retrying") && (
                    <m.p
                      key={phase}
                      role="status"
                      className="flex items-center justify-center gap-2 text-center text-body-sm font-semibold text-[#FDB022]"
                      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      {phase === "retrying" ? <WifiSlash size={18} aria-hidden /> : <WarningCircle size={18} aria-hidden />}
                      {phase === "retrying" ? t("ask.sendFailed") : t("ask.notConfirmed")}
                    </m.p>
                  )}
                </AnimatePresence>

                <AnswerButton
                  kind="yes"
                  chosen={chosen}
                  busy={busy}
                  onClick={() => answer("ME")}
                  label={t("ask.yes")}
                />
                <AnswerButton
                  kind="no"
                  chosen={chosen}
                  busy={busy}
                  onClick={() => answer("NOT_ME")}
                  label={t("ask.no")}
                />
                <p className="mt-1 flex items-center justify-center gap-1.5 text-center text-caption text-[#8D94BC]">
                  <Fingerprint size={16} aria-hidden /> {phase === "sending" ? t("ask.sending") : t("ask.caption")}
                </p>
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* F2 in the real build: the phone's own sheet is up; dim F1 behind it. */}
      <AnimatePresence>
        {!flags.SIMULATION && phase === "unlocking" && (
          <m.div
            className="fixed inset-0 z-40 grid place-items-center bg-[rgba(10,14,31,0.7)] px-8 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <p className="text-body font-semibold text-white">{t("ask.waitingUnlock")}</p>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AnswerButton({
  kind,
  chosen,
  busy,
  onClick,
  label,
}: {
  kind: "yes" | "no";
  chosen: Decision | null;
  busy: boolean;
  onClick: () => void;
  label: string;
}) {
  const reduced = useReduced();
  const decision: Decision = kind === "yes" ? "ME" : "NOT_ME";
  const isChosen = chosen === decision;
  const hidden = chosen !== null && !isChosen;
  // After a tap, the other button fades out and the chosen one expands slightly (B6.4 #10).
  return (
    <m.div
      animate={{ opacity: hidden ? 0 : 1, scale: isChosen && !reduced ? 1.03 : 1 }}
      transition={spring.soft}
      style={{ pointerEvents: hidden ? "none" : undefined }}
      className="relative"
    >
      {kind === "no" && !reduced && chosen === null && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-full"
          style={{
            background: "radial-gradient(closest-side, rgba(229,70,58,0.55), transparent)",
            animation: "glow-breathe 2.6s ease-in-out infinite",
            filter: "blur(8px)",
          }}
        />
      )}
      <Button
        full
        variant={kind === "no" ? "danger" : "success-outline"}
        size={kind === "no" ? "xl" : "lg"}
        loading={busy && isChosen}
        disabled={busy && !isChosen}
        onClick={onClick}
        className={cn(kind === "no" ? "h-16 text-h3 tracking-wide" : "h-14")}
      >
        {label}
      </Button>
    </m.div>
  );
}
