// D4 · The caller says they're police, bank or government (spec B12 D4): a warning seal that
// rocks once, three rule cards that stagger in, the 1930 helpline, cybercrime.gov.in, and a
// disabled "Verify an official" (coming later).
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { ArrowSquareOut, DeviceMobileSlash, VideoCameraSlash, Money } from "@phosphor-icons/react";
import { Seal } from "@/components/Seal";
import { Button } from "@/components/Button";
import { PhoneNumber } from "@/components/PhoneNumber";
import { BottomActions, PageBody } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";

export function Official() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const rules = [
    { icon: VideoCameraSlash, text: t("official.rule1") },
    { icon: Money, text: t("official.rule2") },
    { icon: DeviceMobileSlash, text: t("official.rule3") },
  ];
  return (
    <>
      <TopBar title={t("verify.official")} />
      <PageBody>
        <div className="flex flex-col items-center text-center">
          <m.div
            initial={reduced ? false : { rotate: 0 }}
            animate={reduced ? undefined : { rotate: [0, -6, 5, -3, 0] }}
            transition={{ duration: 0.9, delay: 0.35, ease: "easeInOut" }}
          >
            <Seal size={96} state="warning" tone="amber" draw drawDelay={0.1} />
          </m.div>
          <m.h1 className="mt-5 font-display text-h1 font-semibold text-ink" {...riseIn(1, reduced)}>
            {t("official.title")}
          </m.h1>
        </div>
        <div className="mt-6 flex flex-col gap-3">
          {rules.map(({ icon: Icon, text }, i) => (
            <m.div key={text} className="card flex items-start gap-3.5 p-4" {...riseIn(i + 2, reduced)}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[color-mix(in_oklab,var(--amber)_16%,transparent)] text-chip-amber">
                <Icon size={24} weight="duotone" aria-hidden />
              </span>
              <p className="text-body font-medium text-ink">{text}</p>
            </m.div>
          ))}
        </div>
        <m.div className="mt-6 flex flex-col gap-3" {...riseIn(5, reduced)}>
          <PhoneNumber number="1930" label={t("official.helplineLabel")} />
          <a
            href="https://cybercrime.gov.in"
            target="_blank"
            rel="noreferrer"
            className="card flex min-h-14 items-center gap-3 px-4 text-body font-semibold text-brand-ink"
          >
            <ArrowSquareOut size={22} aria-hidden />
            {t("official.portal")}
          </a>
          <div className="flex flex-col items-center">
            <Button full variant="secondary" disabled>
              {t("official.verifyOfficial")}
            </Button>
            <span className="mt-1.5 text-caption text-muted">{t("official.later")}</span>
          </div>
        </m.div>
        <BottomActions>
          <Button full onClick={() => navigate("/home", { replace: true })}>
            {t("common.done")}
          </Button>
        </BottomActions>
      </PageBody>
    </>
  );
}
