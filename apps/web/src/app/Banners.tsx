// Top banners over any screen (spec B2, G1, B6.4 #12): family alerts drop in with spring.soft
// and a brief red edge glow (never a full-screen takeover); Call Guard prompts show who was
// claimed and the tactics heard, and still need a tap — Call Guard never verifies by itself.
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { ShieldWarning, Waveform, X, UserCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { dismissBanner, useUi, type BannerItem } from "./ui";
import { useReduced } from "./session";
import { dur, spring } from "@/design/motion";
import { formatINR, relativeTime } from "@/lib/format";
import { useFamily } from "@/store/family";
import { markAlertRead } from "@/store/alerts";
import { startCheck } from "./verification";
import { Button } from "@/components/Button";
import { SIM_OFFSET } from "@/components/SimulationBadge";
import type { FamilyMember, Lang } from "@/services/types";
import { cn } from "@/lib/cn";

const GUARD_TIMEOUT = 30_000;
const ALERT_TIMEOUT = 12_000;

export function matchClaimed(family: FamilyMember[] | undefined, claimed: string): FamilyMember | undefined {
  const c = claimed.trim().toLowerCase();
  return family?.find(
    (m) =>
      m.canBeVerified &&
      (m.label.toLowerCase() === c || m.name.toLowerCase() === c || m.name.split(/\s+/)[0]?.toLowerCase() === c),
  );
}

function labelFor(family: FamilyMember[] | undefined, deviceId: string | undefined, fallback: string) {
  if (!deviceId) return fallback;
  return family?.find((m) => m.deviceId === deviceId)?.label ?? fallback;
}

function BannerCard({ item }: { item: BannerItem }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const navigate = useNavigate();
  const reduced = useReduced();
  const family = useFamily();

  useEffect(() => {
    const id = window.setTimeout(() => dismissBanner(item.id), item.kind === "guard" ? GUARD_TIMEOUT : ALERT_TIMEOUT);
    return () => window.clearTimeout(id);
  }, [item]);

  const shell = cn(
    "pointer-events-auto relative overflow-hidden rounded-[22px] bg-surface p-4 text-ink",
    "shadow-[0_22px_48px_rgba(10,14,31,0.28),inset_0_0_0_1px_var(--line)] dark:shadow-[0_22px_48px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.08)]",
  );

  const motionProps = {
    layout: !reduced,
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: -40, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: reduced ? { opacity: 0 } : { opacity: 0, y: -24, transition: { duration: dur.fast } },
    transition: reduced ? { duration: dur.reduced } : spring.soft,
    drag: reduced ? (false as const) : ("y" as const),
    dragConstraints: { top: 0, bottom: 0 },
    dragElastic: { top: 0.7, bottom: 0.05 },
    onDragEnd: (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
      if (info.offset.y < -28 || info.velocity.y < -400) dismissBanner(item.id);
    },
  };

  if (item.kind === "alert") {
    const a = item.alert;
    const about = labelFor(family, a.aboutDeviceId, a.aboutLabel);
    const victim = labelFor(family, a.victimDeviceId, a.victimLabel);
    const imp = a.type === "impersonation";
    return (
      <m.div role="alert" className={shell} {...motionProps}>
        {/* Brief red edge glow as it lands */}
        {imp && (
          <m.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[22px]"
            style={{ boxShadow: "inset 0 0 0 2px #E5463A, inset 0 0 24px rgba(229,70,58,0.45)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: reduced ? 0.6 : [0, 1, 0.35] }}
            transition={{ duration: 1.2, times: [0, 0.2, 1] }}
          />
        )}
        <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", imp ? "bg-[var(--no)]" : "bg-[var(--amber)]")} />
        <div className="flex gap-3 pl-1.5">
          <span
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-full",
              imp ? "bg-[color-mix(in_oklab,var(--no)_14%,transparent)] text-chip-no" : "bg-[color-mix(in_oklab,var(--amber)_16%,transparent)] text-chip-amber",
            )}
          >
            {imp ? <ShieldWarning size={24} weight="duotone" /> : <UserCircle size={24} weight="duotone" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-h3 font-semibold">
              {imp ? t("alerts.imp.title", { about }) : t("alerts.checkOn.title", { about })}
            </p>
            <p className="mt-0.5 text-body-sm text-ink-2">
              {imp
                ? t("alerts.imp.banner", { victim, ago: relativeTime(a.createdAt, lang) })
                : t("alerts.checkOn.body", { victim, about })}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  dismissBanner(item.id);
                  void markAlertRead(a.id);
                  navigate("/alerts");
                }}
              >
                {t("alerts.view")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismissBanner(item.id)}>
                {t("guardBanner.dismiss")}
              </Button>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("a11y.dismiss")}
            onClick={() => dismissBanner(item.id)}
            className="-mr-1 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted active:bg-surface-2"
          >
            <X size={18} />
          </button>
        </div>
      </m.div>
    );
  }

  const p = item.prompt;
  const member = matchClaimed(family, p.claimedLabel);
  const name = member?.label ?? p.claimedLabel;
  return (
    <m.div role="alert" className={shell} {...motionProps}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-brand" />
      <div className="flex gap-3 pl-1.5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-ink">
          <Waveform size={24} weight="duotone" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium uppercase tracking-[0.06em] text-muted">{t("guardBanner.title")}</p>
          <p className="mt-0.5 font-display text-h3 font-semibold">
            {p.amountInr
              ? t("guardBanner.says", { name, amount: formatINR(p.amountInr) })
              : t("guardBanner.saysNoAmount", { name })}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.tactics
              .filter((x) => x !== "identity")
              .map((tac, i) => (
                <m.span
                  key={tac}
                  className="inline-flex h-7 items-center rounded-full bg-surface-2 px-2.5 text-caption font-semibold text-ink-2"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ ...spring.ui, delay: 0.15 + i * 0.05 }}
                >
                  {t(`tactic.${tac}`)}
                </m.span>
              ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="md"
              variant="primary"
              onClick={async () => {
                dismissBanner(item.id);
                if (member) {
                  // The claimed person can be verified: go straight to the waiting screen.
                  const id = await startCheck({ member, reason: "money", amountInr: p.amountInr });
                  navigate(`/verify/waiting/${id}`);
                } else {
                  navigate("/verify/who", { state: { amountInr: p.amountInr } });
                }
              }}
            >
              {t("guardBanner.verifyNow")}
            </Button>
            <Button size="md" variant="ghost" onClick={() => dismissBanner(item.id)}>
              {t("guardBanner.dismiss")}
            </Button>
          </div>
        </div>
      </div>
    </m.div>
  );
}

export function BannerHost() {
  const banners = useUi((s) => s.banners);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[85] mx-auto flex max-w-[480px] flex-col gap-2.5 px-3"
      style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET + 8}px)` }}
    >
      <AnimatePresence initial={false}>
        {banners.map((b) => (
          <BannerCard key={b.id} item={b} />
        ))}
      </AnimatePresence>
    </div>
  );
}
