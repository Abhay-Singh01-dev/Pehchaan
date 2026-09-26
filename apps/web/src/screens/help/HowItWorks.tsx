// I2 · How it works (spec B12 I2): four steps, each with a looping mini animation, and two short
// sections (why a copied voice can't pass; what our server can and can't do). Names come from
// this phone's own data (no hard-coded names).
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { BellRinging, Fingerprint, HandTap, WaveformSlash, CloudArrowUp } from "@phosphor-icons/react";
import { Seal } from "@/components/Seal";
import { PageBody, PageTitle, Section } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useProfile } from "@/store/profile";
import { useFamily } from "@/store/family";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";

function MiniTap() {
  const reduced = useReduced();
  return (
    <div className="relative grid h-16 w-16 place-items-center rounded-[18px] bg-brand text-on-brand">
      <HandTap size={30} weight="duotone" />
      {!reduced && (
        <m.span
          aria-hidden
          className="absolute inset-0 rounded-[18px]"
          style={{ boxShadow: "0 0 0 2px var(--brand)" }}
          animate={{ scale: [1, 1.35], opacity: [0.8, 0] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
        />
      )}
    </div>
  );
}

function MiniAsk() {
  const reduced = useReduced();
  return (
    <div className="grid h-16 w-16 place-items-center rounded-[18px] bg-[#0A0E1F] text-[#B3B9FF]">
      <m.span
        animate={reduced ? undefined : { rotate: [0, 14, -12, 8, -4, 0] }}
        transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.9 }}
        style={{ transformOrigin: "50% 10%" }}
      >
        <BellRinging size={30} weight="duotone" />
      </m.span>
    </div>
  );
}

function MiniUnlock() {
  const reduced = useReduced();
  return (
    <div className="relative grid h-16 w-16 place-items-center rounded-[18px] bg-surface-2 text-muted">
      <Fingerprint size={34} weight="light" />
      <m.span
        aria-hidden
        className="absolute inset-0 grid place-items-center text-brand"
        initial={{ clipPath: "inset(100% 0 0 0)" }}
        animate={reduced ? { clipPath: "inset(0% 0 0 0)" } : { clipPath: ["inset(100% 0 0 0)", "inset(0% 0 0 0)", "inset(0% 0 0 0)"] }}
        transition={{ duration: 2, repeat: reduced ? 0 : Infinity, times: [0, 0.35, 1] }}
      >
        <Fingerprint size={34} weight="bold" />
      </m.span>
    </div>
  );
}

function MiniCheck() {
  const reduced = useReduced();
  return (
    <div className="grid h-16 w-16 place-items-center rounded-[18px] v-ok">
      <svg viewBox="0 0 100 100" width="44" height="44" aria-hidden>
        <circle cx="50" cy="50" r="44" fill="none" stroke="#fff" strokeWidth="4" opacity="0.8" />
        <m.path
          d="M30 52 L44 66 L71 36"
          fill="none"
          stroke="#fff"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
          animate={reduced ? { pathLength: 1 } : { pathLength: [0, 1, 1] }}
          transition={{ duration: 1.8, repeat: reduced ? 0 : Infinity, times: [0, 0.3, 1] }}
        />
      </svg>
    </div>
  );
}

export function useHelpNames() {
  const { t } = useTranslation();
  const profile = useProfile();
  const family = useFamily();
  const iAmAsker = !profile || profile.role !== "can_be_verified" || !profile.keyId;
  const asker = iAmAsker ? null : (family?.find((m) => !m.canBeVerified)?.label ?? t("howItWorks.exampleAsker"));
  const person = iAmAsker ? (family?.find((m) => m.canBeVerified)?.label ?? t("howItWorks.examplePerson")) : null;
  return { asker, person };
}

export function HowItWorks() {
  const { t } = useTranslation();
  const reduced = useReduced();
  const { asker, person } = useHelpNames();
  const steps = [
    { art: <MiniTap />, text: asker ? t("howItWorks.step1", { asker }) : t("howItWorks.step1_you") },
    { art: <MiniAsk />, text: person ? t("howItWorks.step2", { person }) : t("howItWorks.step2_you") },
    { art: <MiniUnlock />, text: person ? t("howItWorks.step3", { person }) : t("howItWorks.step3_you") },
    { art: <MiniCheck />, text: asker ? t("howItWorks.step4", { asker }) : t("howItWorks.step4_you") },
  ];
  return (
    <>
      <TopBar title={t("howItWorks.title")} />
      <PageBody>
        <PageTitle>{t("howItWorks.title")}</PageTitle>
        <ol className="relative flex flex-col gap-3">
          <span aria-hidden className="absolute bottom-10 left-[43px] top-10 w-0.5 bg-[linear-gradient(var(--brass),var(--brand))] opacity-40" />
          {steps.map((s, i) => (
            <m.li key={i} className="card relative flex items-center gap-4 p-3 pr-4" {...riseIn(i + 1, reduced)}>
              {s.art}
              <span className="font-mono text-caption font-semibold text-muted">{i + 1}</span>
              <span className="flex-1 font-display text-h3 font-semibold text-ink">{s.text}</span>
            </m.li>
          ))}
        </ol>

        <m.div {...riseIn(5, reduced)}>
          <Section title={t("howItWorks.voiceTitle")}>
            <div className="card flex gap-3 p-4">
              <WaveformSlash size={28} weight="duotone" className="shrink-0 text-brand" aria-hidden />
              <p className="text-body text-ink-2">
                {person ? t("howItWorks.voiceBody", { person }) : t("howItWorks.voiceBody_you")}
              </p>
            </div>
          </Section>
        </m.div>
        <m.div {...riseIn(6, reduced)}>
          <Section title={t("howItWorks.serverTitle")}>
            <div className="card p-4">
              <div className="flex gap-3">
                <CloudArrowUp size={28} weight="duotone" className="shrink-0 text-brand" aria-hidden />
                <ul className="flex flex-col gap-2 text-body text-ink-2">
                  <li>{t("howItWorks.serverBody1")}</li>
                  <li>{t("howItWorks.serverBody2")}</li>
                  <li>{t("howItWorks.serverBody3")}</li>
                </ul>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
                <Seal size={24} />
                <span className="text-body-sm font-medium text-ink">{t("home.rule")}</span>
              </div>
            </div>
          </Section>
        </m.div>
      </PageBody>
    </>
  );
}
