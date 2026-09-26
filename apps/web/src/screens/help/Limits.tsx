// I3 · What Pehchaan can't protect against (spec B12 I3): four honest cards and a closing line.
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Bug, HandPalm, Password, UserCircleDashed, FirstAidKit } from "@phosphor-icons/react";
import { PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { PhoneNumber } from "@/components/PhoneNumber";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";
import { useHelpNames } from "./HowItWorks";

export function Limits() {
  const { t } = useTranslation();
  const reduced = useReduced();
  const { person } = useHelpNames();
  const cards = [
    { icon: Password, title: person ? t("limits.card1", { name: person }) : t("limits.card1_you"), body: t("limits.card1Body") },
    { icon: Bug, title: t("limits.card2"), body: t("limits.card2Body") },
    { icon: HandPalm, title: t("limits.card3"), body: t("limits.card3Body") },
    { icon: UserCircleDashed, title: t("limits.card4"), body: t("limits.card4Body") },
  ];
  return (
    <>
      <TopBar title={t("limits.title")} />
      <PageBody>
        <PageTitle>{t("limits.title")}</PageTitle>
        <div className="flex flex-col gap-3">
          {cards.map(({ icon: Icon, title, body }, i) => (
            <m.div key={title} className="card flex gap-3.5 p-4" {...riseIn(i + 1, reduced)}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-surface-2 text-ink-2">
                <Icon size={24} weight="duotone" aria-hidden />
              </span>
              <div>
                <p className="font-display text-h3 font-semibold text-ink">{title}</p>
                <p className="mt-1 text-body-sm text-ink-2">{body}</p>
              </div>
            </m.div>
          ))}
        </div>
        <m.div className="mt-6 rounded-[18px] bg-brand-soft p-4" {...riseIn(5, reduced)}>
          <p className="flex gap-2.5 text-body font-medium text-ink">
            <FirstAidKit size={24} weight="duotone" className="shrink-0 text-brand-ink" aria-hidden />
            {t("limits.closing")}
          </p>
          <PhoneNumber className="mt-3" number="112" label="112" />
        </m.div>
      </PageBody>
    </>
  );
}
