// C9 · Add someone far away (spec B12 C9, ENABLE_EXTRAS only): explainer, a request status list
// and a placeholder action. The real two-approval logic comes later.
import { useTranslation } from "react-i18next";
import { HourglassMedium } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { BottomActions, PageBody, PageTitle, Section } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useFamily } from "@/store/family";
import { toast } from "@/app/ui";

export function FarAway() {
  const { t } = useTranslation();
  const family = useFamily();
  const approvers = family?.slice(0, 2) ?? [];
  return (
    <>
      <TopBar title={t("family.farAwayTitle")} />
      <PageBody>
        <PageTitle sub={t("family.farAwayBody", { name: t("common.you") })}>{t("family.farAwayTitle")}</PageTitle>
        <Section title={t("family.farAwayStatus")}>
          <div className="card divide-y divide-line">
            {approvers.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3.5">
                <Avatar name={m.label} color={m.color} size={40} />
                <span className="flex-1 text-body font-medium text-ink">{m.label}</span>
                <span className="inline-flex items-center gap-1.5 text-body-sm text-muted">
                  <HourglassMedium size={18} aria-hidden /> {t("family.farAwayWaiting")}
                </span>
              </div>
            ))}
          </div>
        </Section>
        <BottomActions>
          <Button full onClick={() => toast(t("family.farAwaySoon"))}>
            {t("family.farAwayCta")}
          </Button>
        </BottomActions>
      </PageBody>
    </>
  );
}
