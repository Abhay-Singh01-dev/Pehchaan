// The alert check's progress line (backend spec 11.8), shown in Settings → Alerts and in Diagnostics.
import type { AlertCheck } from "@/app/push";
import { useG } from "@/app/i18n";

export function AlertCheckStatus({ check }: { check: AlertCheck }) {
  const { t } = useG();
  const text =
    check.status === "sent"
      ? t("alertsSettings.testSent")
      : check.status === "arrived"
        ? t("alertsSettings.testArrived", { seconds: check.seconds })
        : check.status === "failed"
          ? t(check.limited ? "alertsSettings.testLimited" : "alertsSettings.testFailed")
          : null;
  if (!text) return null;
  return (
    <p role="status" className="mt-3 text-body-sm text-ink-2" data-testid="alert-check-status">
      {text}
    </p>
  );
}
