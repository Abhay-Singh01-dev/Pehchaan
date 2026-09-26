// D5 · Payment check (spec B12 D5, ENABLE_EXTRAS only): a mock bank-transfer interstitial.
// "You're sending ₹50,000 to a new person right after a call. Did someone on the phone ask you to?"
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Bank } from "@phosphor-icons/react";
import { Button } from "@/components/Button";
import { BottomActions, PageBody } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";
import { formatINR } from "@/lib/format";

export function PaymentCheck() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  return (
    <>
      <TopBar title={t("payment.title")} />
      <PageBody>
        <m.div className="card mt-2 p-5" {...riseIn(0, reduced)}>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-surface-2 text-ink-2">
              <Bank size={26} weight="duotone" aria-hidden />
            </span>
            <div>
              <div className="text-caption text-muted">{t("payment.to")}</div>
              <div className="font-mono text-mono-lg font-semibold text-ink">{formatINR(50000)}</div>
            </div>
          </div>
        </m.div>
        <m.h1 className="mt-6 font-display text-h1 font-semibold text-ink" {...riseIn(1, reduced)}>
          {t("payment.question", { amount: formatINR(50000) })}
        </m.h1>
        <BottomActions>
          <Button full onClick={() => navigate("/verify/who")}>
            {t("payment.verifyFirst")}
          </Button>
          <Button full variant="ghost" onClick={() => navigate("/home", { replace: true })}>
            {t("payment.continue")}
          </Button>
        </BottomActions>
      </PageBody>
    </>
  );
}
