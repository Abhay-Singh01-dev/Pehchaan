// D3 · Waiting (spec B12 D3, B6.4 #7). The waiting gradient; my avatar (left) and theirs (right)
// joined by a dotted arc; a glowing dot travels from me to them (1.1 s, looping) and their
// avatar pulses each time it lands; the countdown ring sits behind them (amber in the last 10 s).
// When the answer arrives the dot travels back once, faster, and the verdict reveals from my
// avatar. Wake lock on. Cancel (and the back gesture) ask "Stop waiting?" in-page.
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { ChatCircleText } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { CountdownRing, useSecondsLeft } from "@/components/Countdown";
import { InlineConfirm } from "@/components/InlineConfirm";
import { ArcTraveler, arcPath } from "@/components/illustrations";
import { SIM_OFFSET } from "@/components/SimulationBadge";
import { useOutgoing } from "@/store/requests";
import { useMember } from "@/store/family";
import { useProfile } from "@/store/profile";
import { cancelCheck, watch } from "@/app/verification";
import { useReduced } from "@/app/session";
import { useWakeLock } from "@/design/wakeLock";
import { pinOriginFromElement } from "@/design/origin";
import { dur, ease, riseIn } from "@/design/motion";

const W = 320;
const H = 190;
const ME: [number, number] = [64, 128];
const THEM: [number, number] = [256, 128];
const LIFT = 92;

export function Waiting() {
  const { requestId } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const record = useOutgoing(requestId);
  const member = useMember(record?.memberId);
  const profile = useProfile();
  const meRef = useRef<HTMLDivElement>(null);
  const [arrivals, setArrivals] = useState(0);
  const [returning, setReturning] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const leaving = useRef(false);

  useWakeLock(true);

  useEffect(() => {
    if (requestId) watch(requestId);
  }, [requestId]);

  // Android back gesture → "Stop waiting?" instead of leaving silently.
  const blocker = useBlocker(({ historyAction }) => historyAction === "POP" && !leaving.current);
  useEffect(() => {
    if (blocker.state === "blocked") {
      setConfirmCancel(true);
      blocker.reset();
    }
  }, [blocker]);

  const goToResult = useCallback(() => {
    if (!requestId || leaving.current) return;
    leaving.current = true;
    pinOriginFromElement(meRef.current);
    navigate(`/verify/result/${requestId}`, { replace: true });
  }, [navigate, requestId]);

  // The verdict is in: send the dot home once (if an answer arrived), then reveal.
  useEffect(() => {
    if (!record) return;
    if (record.status === "cancelled") {
      leaving.current = true;
      navigate("/home", { replace: true });
      return;
    }
    if (record.status === "done" && !returning && !leaving.current) {
      const answered = record.result && record.result.verdict !== "NO_RESPONSE";
      if (answered && !reduced) setReturning(true);
      else goToResult();
    }
  }, [record, returning, reduced, goToResult, navigate]);

  const onArrive = useCallback(() => setArrivals((n) => n + 1), []);

  if (record === null) {
    return (
      <div className="v-wait grid min-h-app place-items-center p-6 text-center">
        <Button variant="on-verdict" onClick={() => navigate("/home", { replace: true })}>
          {t("common.goHome")}
        </Button>
      </div>
    );
  }
  if (!record?.request || !profile) return <div className="v-wait min-h-app" />;

  const label = record.memberLabel;
  const expiresAt = record.request.expiresAt;

  return (
    <div className="v-wait relative flex min-h-app flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_50%_at_50%_0%,rgba(255,255,255,0.14),transparent_60%)]" />
      <div className="relative mx-auto flex w-full max-w-[480px] flex-1 flex-col px-6" style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET + 28}px)` }}>
        {/* The arc */}
        <div className="relative mx-auto" style={{ width: W, height: H }}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="absolute inset-0" aria-hidden style={{ overflow: "visible" }}>
            <path d={arcPath(ME, THEM, LIFT)} fill="none" stroke="rgba(217,184,116,0.75)" strokeWidth={2} strokeDasharray="1 8" strokeLinecap="round" />
            {!returning && !reduced && <ArcTraveler from={ME} to={THEM} lift={LIFT} duration={1.1} color="#FFFFFF" onArrive={onArrive} />}
            {returning && (
              <ArcTraveler from={ME} to={THEM} lift={LIFT} duration={0.55} color="#FFFFFF" loop={false} reverse onArrive={goToResult} />
            )}
          </svg>
          <div ref={meRef} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: ME[0], top: ME[1] }}>
            <Avatar name={profile.name} color={profile.color} size={72} />
            <p className="mt-2 text-center text-body-sm font-medium text-white/85">{t("wait.you")}</p>
          </div>
          <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: THEM[0], top: THEM[1] }}>
            <div className="relative grid h-[72px] w-[72px] place-items-center">
              <CountdownRing
                expiresAt={expiresAt}
                size={120}
                stroke={4}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              />
              {/* A gentle pulse each time the dot lands. */}
              <AnimatePresence>
                {!reduced && (
                  <m.span
                    key={arrivals}
                    aria-hidden
                    className="absolute inset-0 rounded-full"
                    style={{ boxShadow: "0 0 0 2px rgba(255,255,255,0.7)" }}
                    initial={{ scale: 1, opacity: 0.8 }}
                    animate={{ scale: 1.5, opacity: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                )}
              </AnimatePresence>
              {member ? (
                <Avatar name={member.label} color={member.color} size={72} />
              ) : (
                <span className="block h-[72px] w-[72px] rounded-full bg-white/20" />
              )}
            </div>
            <p className="mt-8 text-center text-body-sm font-medium text-white/85">{label}</p>
          </div>
        </div>

        <WaitingText label={label} expiresAt={expiresAt} />

        <div className="flex-1" />
        <div className="pb-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
          <InlineConfirm
            tone="verdict"
            open={confirmCancel}
            message={t("wait.cancelConfirm", { name: label })}
            confirmLabel={t("wait.stop")}
            cancelLabel={t("wait.keep")}
            onCancel={() => setConfirmCancel(false)}
            onConfirm={async () => {
              leaving.current = true;
              await cancelCheck(record.requestId);
              navigate("/home", { replace: true });
            }}
          />
          {!confirmCancel && (
            <Button full variant="on-verdict-ghost" onClick={() => setConfirmCancel(true)}>
              {t("wait.cancel")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function WaitingText({ label, expiresAt }: { label: string; expiresAt: number }) {
  const { t } = useTranslation();
  const reduced = useReduced();
  const seconds = useSecondsLeft(expiresAt);
  const late = seconds <= 10;
  return (
    <div className="mt-6 text-center text-white">
      <m.h1 className="font-display text-h1 font-semibold" {...riseIn(0, reduced, 0.3)}>
        {t("wait.title", { name: label })}
      </m.h1>
      <p className="mt-2 font-mono text-mono-lg font-semibold tabular-nums text-white/90" aria-live="off">
        0:{String(seconds).padStart(2, "0")}
      </p>
      <m.div
        className="mt-6 flex items-start gap-3 rounded-[20px] bg-white/[0.09] p-4 text-left shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]"
        {...riseIn(1, reduced, 0.3)}
        aria-live="polite"
      >
        <ChatCircleText size={26} weight="duotone" className="mt-0.5 shrink-0 text-[#D9B874]" aria-hidden />
        <AnimatePresence mode="wait" initial={false}>
          <m.p
            key={late ? "late" : "say"}
            className="text-body font-semibold"
            initial={{ opacity: 0, y: reduced ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -6 }}
            transition={{ duration: dur.base, ease: ease.out }}
          >
            {late ? t("wait.still", { name: label }) : t("wait.say")}
          </m.p>
        </AnimatePresence>
      </m.div>
      <m.p className="mt-4 text-body-sm text-white/80" {...riseIn(2, reduced, 0.3)}>
        {t("wait.calm")}
      </m.p>
    </div>
  );
}
