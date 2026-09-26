// Family alert cards (spec G1 card, G2 card), used on Home and in G0.
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { CheckCircle, ShieldWarning, UserCircle } from "@phosphor-icons/react";
import type { FamilyAlert, FamilyMember, Lang } from "@/services/types";
import { PhoneNumber } from "./PhoneNumber";
import { Button } from "./Button";
import { relativeTime } from "@/lib/format";
import { resolveAlert } from "@/store/alerts";
import { cn } from "@/lib/cn";

export function alertLabels(alert: FamilyAlert, family: FamilyMember[] | undefined) {
  const find = (id?: string) => (id ? family?.find((m) => m.deviceId === id) : undefined);
  const about = find(alert.aboutDeviceId);
  const victim = find(alert.victimDeviceId);
  return {
    about: about?.label ?? alert.aboutLabel,
    victim: victim?.label ?? alert.victimName,
    aboutPhone: about?.phone ?? alert.aboutPhone,
    victimPhone: victim?.phone ?? alert.victimPhone,
  };
}

export function AlertCard({
  alert,
  family,
  compact,
  className,
}: {
  alert: FamilyAlert;
  family: FamilyMember[] | undefined;
  compact?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const { about, victim, aboutPhone, victimPhone } = alertLabels(alert, family);
  const imp = alert.type === "impersonation";

  return (
    <div className={cn("card relative overflow-hidden p-4", className)}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", imp ? "bg-[var(--no)]" : "bg-[var(--amber)]")} />
      <div className="flex gap-3 pl-1">
        <span
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-full",
            imp
              ? "bg-[color-mix(in_oklab,var(--no)_13%,transparent)] text-chip-no"
              : "bg-[color-mix(in_oklab,var(--amber)_15%,transparent)] text-chip-amber",
          )}
        >
          {imp ? (
            <ShieldWarning size={24} weight="duotone" aria-hidden />
          ) : (
            <UserCircle size={24} weight="duotone" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-display text-h3 font-semibold text-ink">
              {imp ? t("alerts.imp.title", { about }) : t("alerts.checkOn.title", { about })}
            </p>
            {!alert.read && (
              <span
                className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
                role="img"
                aria-label={t("alerts.unread")}
              />
            )}
          </div>
          <p className="mt-1 text-body-sm text-ink-2">
            {imp
              ? `${t("alerts.imp.banner", { victim, ago: relativeTime(alert.createdAt, lang) })} ${t("alerts.imp.card", { about })}`
              : t("alerts.checkOn.body", { victim, about })}
          </p>
          {!imp && <p className="mt-1 text-caption text-muted">{relativeTime(alert.createdAt, lang)}</p>}
        </div>
      </div>
      {!compact && (
        <div className="mt-3 flex flex-col gap-2">
          {imp && victimPhone && <PhoneNumber number={victimPhone} label={t("alerts.call", { name: victim })} />}
          {!imp && aboutPhone && <PhoneNumber number={aboutPhone} label={t("alerts.call", { name: about })} />}
          {!imp &&
            (alert.resolved ? (
              <m.p
                className="flex items-center gap-2 text-body-sm font-medium text-chip-ok"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <CheckCircle size={20} weight="fill" aria-hidden /> {t("alerts.checkOn.resolved")}
              </m.p>
            ) : (
              <Button variant="secondary" size="md" onClick={() => void resolveAlert(alert.id)}>
                {t("alerts.checkOn.reached")}
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}
