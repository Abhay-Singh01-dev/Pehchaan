// I4 · During a suspicious call (spec B12 I4): five numbered steps.
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { ArrowSquareOut, ShieldCheck } from "@phosphor-icons/react";
import { Button } from "@/components/Button";
import { PhoneNumber } from "@/components/PhoneNumber";
import { PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";

export function SuspiciousCall() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const steps = [1, 2, 3, 4, 5].map((n) => t(`suspicious.step${n}`));
  return (
    <>
      <TopBar title={t("suspicious.title")} />
      <PageBody>
        <PageTitle>{t("suspicious.title")}</PageTitle>
        <ol className="flex flex-col gap-3">
          {steps.map((s, i) => (
            <m.li key={i} className="card flex items-start gap-4 p-4" {...riseIn(i + 1, reduced)}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand font-mono text-body font-semibold text-on-brand">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 pt-1.5">
                <p className="text-body font-medium text-ink">{s}</p>
                {i === 1 && (
                  <Button className="mt-3" size="md" icon={<ShieldCheck size={20} weight="duotone" />} onClick={() => navigate("/verify/who")}>
                    {t("home.verify")}
                  </Button>
                )}
                {i === 4 && (
                  <div className="mt-3 flex flex-col gap-2">
                    <PhoneNumber number="1930" label={t("official.helplineLabel")} />
                    <a
                      href="https://cybercrime.gov.in"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-2 text-body-sm font-semibold text-brand-ink"
                    >
                      <ArrowSquareOut size={18} aria-hidden /> cybercrime.gov.in
                    </a>
                  </div>
                )}
              </div>
            </m.li>
          ))}
        </ol>
      </PageBody>
    </>
  );
}
