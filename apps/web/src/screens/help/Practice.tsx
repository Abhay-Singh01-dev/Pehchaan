// I6 · Practice a scam call (spec B12 I6, ENABLE_EXTRAS only): a pretend call screen with
// chat-style captions of a scam script and a coach mark guiding the person to tap Verify,
// ending in a practice red verdict clearly marked "Practice". No request is ever sent.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { PhoneIncoming, ShieldCheck } from "@phosphor-icons/react";
import { SCRIPTED_CALL } from "@/services/guard/rules";
import { Button } from "@/components/Button";
import { Seal } from "@/components/Seal";
import { SIM_OFFSET } from "@/components/SimulationBadge";
import { useFamily } from "@/store/family";
import { useReduced } from "@/app/session";
import { spring } from "@/design/motion";

export function Practice() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const family = useFamily();
  const name = family?.find((m) => m.canBeVerified)?.label ?? t("howItWorks.examplePerson");
  const [lines, setLines] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done || lines >= 4) return;
    const id = window.setTimeout(() => setLines((n) => n + 1), lines === 0 ? 600 : 1800);
    return () => window.clearTimeout(id);
  }, [lines, done]);

  if (done) {
    return (
      <div
        className="v-no relative flex min-h-app flex-col items-center px-6 text-center"
        style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET + 48}px)` }}
      >
        <span className="mb-6 rounded-full bg-white/15 px-3 py-1 text-caption font-semibold uppercase tracking-[0.08em]">
          {t("practice.badge")}
        </span>
        <m.div
          initial={reduced ? { opacity: 0 } : { scale: 1.3, rotate: -8, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={spring.stamp}
        >
          <Seal size={120} state="denied" tone="light" draw drawDelay={0.15} />
        </m.div>
        <h1 className="mt-7 font-display text-display font-semibold">{t("practice.verdictTitle", { name })}</h1>
        <p className="mt-3 max-w-[32ch] text-body font-medium">{t("practice.verdictBody", { name })}</p>
        <div className="flex-1" />
        <div
          className="flex w-full flex-col gap-2.5"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
        >
          <Button full variant="on-verdict" onClick={() => navigate(-1)}>
            {t("practice.done")}
          </Button>
          <Button
            full
            variant="on-verdict-ghost"
            onClick={() => {
              setDone(false);
              setLines(0);
            }}
          >
            {t("practice.again")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="v-ink relative flex min-h-app flex-col px-5"
      style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET + 16}px)` }}
    >
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-white/10 px-3 py-1 text-caption font-semibold uppercase tracking-[0.08em] text-[#FDB022]">
          {t("practice.badge")}
        </span>
        <span className="flex items-center gap-1.5 text-caption text-[#8D94BC]">
          <PhoneIncoming size={16} /> {t("practice.incoming")}
        </span>
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        <AnimatePresence initial={false}>
          {SCRIPTED_CALL.slice(0, lines).map((l, i) => (
            <m.p
              key={i}
              className="max-w-[85%] rounded-[18px] rounded-tl-[6px] bg-white/[0.08] px-4 py-3 text-body text-[#EEF0FF]"
              initial={{ opacity: 0, y: reduced ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.soft}
            >
              {l}
            </m.p>
          ))}
        </AnimatePresence>
      </div>
      <div className="flex-1" />
      <div className="relative pb-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}>
        {lines >= 2 && (
          <m.div
            className="mb-3 rounded-[16px] bg-[#FDB022] p-3 text-[#1F1300]"
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: reduced ? 0 : [0, -4, 0] }}
            transition={{ y: { duration: 1.2, repeat: Infinity }, opacity: { duration: 0.3 } }}
          >
            <p className="font-display text-h3 font-semibold">{t("practice.coach")}</p>
            <p className="text-body-sm">{t("practice.coachHint")}</p>
          </m.div>
        )}
        <Button full icon={<ShieldCheck size={22} weight="duotone" />} onClick={() => setDone(true)}>
          {t("home.verify")}
        </Button>
      </div>
    </div>
  );
}
