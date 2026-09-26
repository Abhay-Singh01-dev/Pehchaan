// I9 · Settings → Alerts (backend spec 11.2, 11.8; FC-8, FC-9, FC-10).
//   - Whether alerts work on this phone, with "Turn on" when they're off (asked inside the tap).
//   - iPhone: alerts only work in the app added to the Home Screen.
//   - Android: "Make alerts reliable on this phone", the battery-saver steps for this phone's maker.
//   - "Send an alert check": the relay pushes to this phone after 10 s; the arrival time is shown.
import { useEffect, useState } from "react";
import * as m from "motion/react-m";
import { BatteryCharging, BellRinging, CheckCircle, DeviceMobile } from "@phosphor-icons/react";
import { AlertCheckStatus } from "@/components/AlertCheckStatus";
import { Button } from "@/components/Button";
import { PageBody, PageTitle, Section } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { push, useAlertCheck, useAlertsState, type AlertsState, type EnableResult } from "@/app/push";
import { batterySteps, phoneBrand, phoneModel, type PhoneBrand } from "@/app/phoneBrand";
import { detectPlatform } from "@/app/pwa";
import { useG } from "@/app/i18n";
import { toast } from "@/app/ui";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";
import { cn } from "@/lib/cn";

const STATE_KEY: Record<AlertsState, string> = {
  on: "on",
  off: "off",
  blocked: "blocked",
  install_first: "off",
  unsupported: "unsupported",
};

export function AlertsSettings() {
  const { t } = useG();
  const reduced = useReduced();
  const live = useAlertsState();
  const [override, setOverride] = useState<AlertsState | null>(null);
  const [turning, setTurning] = useState(false);
  const [failed, setFailed] = useState<EnableResult | null>(null);
  const [brand, setBrand] = useState<PhoneBrand>(() => phoneBrand(navigator.userAgent));
  const { check, send } = useAlertCheck();
  const platform = detectPlatform();
  const state = override ?? live;

  useEffect(() => {
    let alive = true;
    void phoneModel().then((model) => alive && model && setBrand(phoneBrand(navigator.userAgent, model)));
    return () => {
      alive = false;
    };
  }, []);

  const turnOn = async () => {
    setTurning(true);
    setFailed(null);
    const r = await push.enable();
    setTurning(false);
    if (r === "granted") {
      setOverride("on");
      toast(t("notif.on"), { tone: "success" });
    } else {
      setOverride(await push.state());
      setFailed(r);
    }
  };

  return (
    <>
      <TopBar title={t("alertsSettings.title")} />
      <PageBody>
        <PageTitle sub={t("notif.body")}>{t("alertsSettings.title")}</PageTitle>

        <m.div className="card p-4" {...riseIn(0, reduced)}>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded-full",
                state === "on" ? "text-chip-ok" : "bg-surface-2 text-ink-2",
              )}
              style={state === "on" ? { background: "color-mix(in oklab, var(--ok) 14%, transparent)" } : undefined}
            >
              {state === "on" ? (
                <CheckCircle size={24} weight="fill" aria-hidden />
              ) : (
                <BellRinging size={24} aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-sm text-muted">{t("alertsSettings.stateLabel")}</span>
              <span className="block text-body font-semibold text-ink" data-testid="alerts-state">
                {state ? t(`alertsSettings.state.${STATE_KEY[state]}`) : "…"}
              </span>
            </span>
            {state === "off" && (
              <Button size="md" loading={turning} onClick={turnOn}>
                {t("alertsSettings.turnOn")}
              </Button>
            )}
          </div>
          {state === "off" && !failed && <p className="mt-3 text-body-sm text-ink-2">{t("notif.denied")}</p>}
          {state === "blocked" && <p className="mt-3 text-body-sm text-ink-2">{t("alertsSettings.blockedHint")}</p>}
          {state === "install_first" && <p className="mt-3 text-body-sm text-ink-2">{t("notif.iosInstallFirst")}</p>}
          {state === "unsupported" && <p className="mt-3 text-body-sm text-ink-2">{t("notif.unsupported")}</p>}
          {failed === "failed" && (
            <p role="alert" className="mt-3 text-body-sm text-ink-2">
              {t("notif.failed")}
            </p>
          )}
        </m.div>

        {platform === "ios" && (
          <m.p className="card mt-4 flex items-start gap-3 p-4 text-body-sm text-ink-2" {...riseIn(1, reduced)}>
            <DeviceMobile size={22} className="mt-0.5 shrink-0 text-brand" aria-hidden />
            {t("alertsSettings.iphone")}
          </m.p>
        )}

        {platform === "android" && (
          <Section
            title={
              <span className="inline-flex items-center gap-2">
                <BatteryCharging size={20} className="text-brand" aria-hidden /> {t("alertsSettings.reliable")}
              </span>
            }
          >
            <div className="card p-4">
              <p className="text-body-sm font-semibold text-ink">{t(`alertsSettings.brand.${brand}`)}</p>
              <p className="mt-1 text-body-sm text-ink-2">{t("alertsSettings.reliableIntro")}</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-body-sm text-ink">
                {batterySteps(brand).map((s) => (
                  <li key={s}>{t(`alertsSettings.steps.${s}`)}</li>
                ))}
              </ol>
            </div>
          </Section>
        )}

        {state === "on" && (
          <Section title={t("alertsSettings.checkTitle")}>
            <div className="card p-4">
              <Button
                full
                variant="secondary"
                icon={<BellRinging size={20} />}
                loading={check.status === "sending"}
                onClick={() => void send()}
              >
                {t("alertsSettings.testCta")}
              </Button>
              <AlertCheckStatus check={check} />
            </div>
          </Section>
        )}
      </PageBody>
    </>
  );
}
