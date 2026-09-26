// G0 · Alerts (spec B12 G0): newest first, each a card with an icon, title, body, relative time
// and an unread dot; "Mark all read". Cards stagger in; a card slides out of "unread" when read.
import { useEffect } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Checks } from "@phosphor-icons/react";
import { AlertCard } from "@/components/AlertCard";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ShieldIllustration } from "@/components/illustrations";
import { PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { markAllAlertsRead, useAlerts } from "@/store/alerts";
import { useFamily } from "@/store/family";
import { dismissBanner, useUi } from "@/app/ui";
import { useReduced } from "@/app/session";
import { riseIn, spring } from "@/design/motion";

export function Alerts() {
  const { t } = useTranslation();
  const alerts = useAlerts();
  const family = useFamily();
  const reduced = useReduced();
  const unread = alerts?.filter((a) => !a.read).length ?? 0;

  // Opening the list clears any alert banners still showing.
  useEffect(() => {
    useUi.getState().banners.filter((b) => b.kind === "alert").forEach((b) => dismissBanner(b.id));
  }, []);

  return (
    <>
      <TopBar title={t("alerts.title")} />
      <PageBody>
        <PageTitle>{t("alerts.title")}</PageTitle>
        {alerts && alerts.length === 0 ? (
          <EmptyState illustration={<ShieldIllustration />} text={t("alerts.empty")} />
        ) : (
          <>
            {unread > 0 && (
              <div className="-mt-3 mb-3 flex justify-end">
                <Button variant="ghost" size="sm" icon={<Checks size={18} weight="bold" />} onClick={() => void markAllAlertsRead()}>
                  {t("alerts.markAll")}
                </Button>
              </div>
            )}
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {alerts?.map((a, i) => (
                  <m.div
                    key={a.id}
                    layout={!reduced}
                    {...riseIn(i, reduced)}
                    exit={{ opacity: 0, x: reduced ? 0 : 40 }}
                    transition={{ ...riseIn(i, reduced).transition, layout: spring.soft }}
                  >
                    <AlertCard alert={a} family={family} />
                  </m.div>
                ))}
              </AnimatePresence>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
