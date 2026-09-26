// F3 · Answer sent (spec B12 F3, B6.4 #11).
//   NOT ME: the chosen answer compresses into a small sealed envelope that flies along an arc
//           toward the top edge (to the asker), then the confirmation text appears.
//   YES:    "{asker} can see it's really you", with the two confirmation words if present.
// Both are recorded in History as "answered".
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { PhoneNumber } from "@/components/PhoneNumber";
import { Seal } from "@/components/Seal";
import { SIM_OFFSET } from "@/components/SimulationBadge";
import { useIncoming, usePendingIncoming } from "@/store/requests";
import { useFamily } from "@/store/family";
import { useReduced } from "@/app/session";
import { ease, spring } from "@/design/motion";

function Envelope({ onGone }: { onGone: () => void }) {
  const reduced = useReduced();
  const { t } = useTranslation();
  const [stage, setStage] = useState<"pill" | "env">(reduced ? "env" : "pill");
  useEffect(() => {
    if (reduced) {
      onGone();
      return;
    }
    const a = window.setTimeout(() => setStage("env"), 320);
    return () => window.clearTimeout(a);
  }, [reduced, onGone]);

  if (reduced) return null;
  return (
    <div className="pointer-events-none relative grid h-40 place-items-center">
      {stage === "pill" ? (
        <m.div
          className="grid h-16 w-[280px] place-items-center rounded-full bg-[#E5463A] font-bold text-white shadow-[0_14px_32px_-12px_rgba(229,70,58,0.75)]"
          initial={{ scaleX: 1, scaleY: 1, borderRadius: 32 }}
          animate={{ scaleX: 0.3, scaleY: 1.1, borderRadius: 12 }}
          transition={{ duration: 0.3, ease: ease.inOut }}
        >
          <m.span animate={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {t("ask.no")}
          </m.span>
        </m.div>
      ) : (
        <m.svg
          viewBox="0 0 96 68"
          width="96"
          height="68"
          aria-hidden
          initial={{ scale: 0.8, x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{
            scale: [0.8, 1, 0.9, 0.45],
            x: [0, 0, 70, 20],
            y: [0, -10, -180, -420],
            rotate: [0, 0, -10, -18],
            opacity: [1, 1, 1, 0],
          }}
          transition={{ duration: 0.95, times: [0, 0.2, 0.6, 1], ease: ease.inOut }}
          onAnimationComplete={onGone}
        >
          <rect x="2" y="2" width="92" height="64" rx="9" fill="#EEF0FF" />
          <path d="M4 8 L48 40 L92 8" fill="none" stroke="#C3C8E8" strokeWidth="3" strokeLinejoin="round" />
          <circle cx="48" cy="38" r="12" fill="#B8904A" />
          <circle cx="48" cy="38" r="8.5" fill="none" stroke="#F3EAD8" strokeWidth="1.2" strokeDasharray="2 1.6" />
        </m.svg>
      )}
    </div>
  );
}

export function Sent() {
  const { requestId } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const record = useIncoming(requestId);
  const family = useFamily();
  const pending = usePendingIncoming();
  const [envelopeGone, setEnvelopeGone] = useState(false);
  const onGone = useCallback(() => setEnvelopeGone(true), []);

  if (record === null) return <Navigate to="/home" replace />;
  if (!record?.decision) return <div className="v-ink min-h-app" />;

  const req = record.request;
  const askerMember = family?.find((mm) => mm.deviceId === req.fromDeviceId);
  const asker = askerMember?.label ?? req.fromName;
  const phone = askerMember?.phone ?? req.fromPhone;
  const next = (pending ?? []).find((p) => p.requestId !== record.requestId);
  const notMe = record.decision === "NOT_ME";
  const showText = !notMe || envelopeGone;

  const rise = (i: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.12 } }
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.42, delay: 0.1 + i * 0.07, ease: ease.out },
        };

  return (
    <div className="v-ink relative flex min-h-app flex-col overflow-hidden">
      <div
        className="relative mx-auto flex w-full max-w-[480px] flex-1 flex-col px-6"
        style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET + 40}px)` }}
      >
        {notMe ? (
          !envelopeGone && <Envelope onGone={onGone} />
        ) : (
          <div className="flex justify-center pt-4">
            <m.div
              initial={reduced ? { opacity: 0 } : { scale: 1.3, rotate: -8, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={reduced ? { duration: 0.12 } : { default: spring.stamp, opacity: { duration: 0.1 } }}
            >
              <Seal size={96} state="confirmed" tone="light" draw drawDelay={0.15} />
            </m.div>
          </div>
        )}

        {showText && (
          <div className="mt-6 text-center" role="status" aria-live="polite">
            {notMe && (
              <m.div className="mb-6 flex justify-center" {...rise(0)}>
                <Seal size={72} state="denied" tone="light" draw drawDelay={0.1} />
              </m.div>
            )}
            <m.h1 className="font-display text-h1 font-semibold text-white" {...rise(1)}>
              {notMe ? t("sent.no.title", { asker }) : t("sent.yes.title", { asker })}
            </m.h1>
            {notMe && (
              <m.p className="mt-3 text-body font-medium text-[#C3C8E8]" {...rise(2)}>
                {t("sent.no.body", { asker })}
              </m.p>
            )}
            {!notMe && record.words && (
              <m.div
                className="mt-6 rounded-[20px] bg-white/[0.08] p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
                {...rise(2)}
              >
                <p className="text-body font-medium text-[#C3C8E8]">{t("sent.yes.words", { asker })}</p>
                <p className="mt-3 font-mono text-[1.75rem] font-semibold tracking-[0.06em] text-white">
                  {record.words[0]} <span className="text-[#D9B874]">·</span> {record.words[1]}
                </p>
                <p className="mt-2 text-body-sm text-[#8D94BC]">{t("sent.yes.wordsCaption")}</p>
              </m.div>
            )}
          </div>
        )}

        <div className="flex-1" />
        {showText && (
          <m.div
            className="mt-8 flex flex-col gap-2.5"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
            {...rise(3)}
          >
            {notMe && phone && <PhoneNumber number={phone} label={t("sent.call", { asker })} tone="light" />}
            {next ? (
              <Button
                full
                variant="on-verdict"
                onClick={() => navigate(`/request/${next.requestId}`, { replace: true })}
              >
                {t("sent.next")}
              </Button>
            ) : null}
            <Button
              full
              variant={next ? "on-verdict-ghost" : "on-verdict"}
              onClick={() => navigate("/home", { replace: true })}
            >
              {t("common.done")}
            </Button>
          </m.div>
        )}
      </div>
    </div>
  );
}
