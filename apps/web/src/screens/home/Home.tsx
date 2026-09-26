// B1 · Home (spec B12 B1). Header, then the Verify card, then rows, staggered on first mount
// only (not on every tab return). Pulling down refreshes presence.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { ArrowRight, Bell, BellRinging, Plus, ShieldCheck } from "@phosphor-icons/react";
import { services } from "@/services";
import { Avatar } from "@/components/Avatar";
import { BigButton } from "@/components/BigButton";
import { ConnectionPill } from "@/components/ConnectionPill";
import { Seal } from "@/components/Seal";
import { EmptyState } from "@/components/EmptyState";
import { AlertCard } from "@/components/AlertCard";
import { Button } from "@/components/Button";
import { PullToRefresh } from "@/components/PullToRefresh";
import { FamilyIllustration } from "@/components/illustrations";
import { PageBody } from "@/components/screen/Page";
import { useProfile } from "@/store/profile";
import { useFamily } from "@/store/family";
import { useAlerts, useUnreadAlertCount } from "@/store/alerts";
import { usePendingIncoming, useRecentCheck } from "@/store/requests";
import { useConnection, useReachable, useReduced, useSession } from "@/app/session";
import { checkAgain } from "@/app/verification";
import { reasonLabel } from "@/lib/labels";
import { riseIn, spring } from "@/design/motion";
import { cn } from "@/lib/cn";
import { PageSkeleton } from "@/components/Skeleton";

export function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  const family = useFamily();
  const alerts = useAlerts();
  const unread = useUnreadAlertCount();
  const recent = useRecentCheck();
  const pending = usePendingIncoming();
  const connection = useConnection();
  const reachable = useReachable();
  const reducedPref = useReduced();
  // Stagger only on the first visit this session.
  const [intro] = useState(() => !useSession.getState().homeIntroPlayed);
  useEffect(() => {
    useSession.setState({ homeIntroPlayed: true });
  }, []);
  const reduced = reducedPref || !intro;

  const verifiable = useMemo(() => family?.filter((m) => m.canBeVerified) ?? [], [family]);
  const unreadAlerts = useMemo(() => alerts?.filter((a) => !a.read).slice(0, 2) ?? [], [alerts]);
  const firstPending = pending?.[0];
  const pendingAsker = firstPending
    ? (family?.find((m) => m.deviceId === firstPending.request.fromDeviceId)?.label ?? firstPending.request.fromName)
    : null;

  const refresh = async () => {
    services.relay.announce({
      name: profile?.name ?? "",
      kind: "phone",
      canBeVerified: profile?.role === "can_be_verified" && Boolean(profile?.keyId),
    });
    await new Promise((r) => setTimeout(r, 900));
  };

  if (!profile) return <PageSkeleton />;
  const firstName = profile.name.split(/\s+/)[0] ?? profile.name;

  return (
    <PullToRefresh onRefresh={refresh}>
      <PageBody noTopBar withTabBar>
        {/* 1 · Header */}
        <m.header className="flex items-start gap-3" {...(intro ? riseIn(0, reduced) : {})}>
          <button
            type="button"
            onClick={() => navigate("/settings/profile")}
            aria-label={profile.name}
            className="rounded-full"
          >
            <Avatar name={profile.name} color={profile.color} size={44} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="break-words font-display text-h2 font-semibold text-ink">
              {t("home.greeting", { name: firstName })}
            </h1>
            <ConnectionPill state={connection} className="mt-1.5" />
          </div>
          <m.button
            type="button"
            whileTap={{ scale: 0.92 }}
            transition={spring.ui}
            onClick={() => navigate("/alerts")}
            aria-label={unread ? t("a11y.alertsUnread", { count: unread }) : t("a11y.alerts")}
            className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-[var(--shadow-1),inset_0_0_0_1px_var(--line)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
          >
            {unread ? <BellRinging size={24} weight="duotone" /> : <Bell size={24} />}
            {unread > 0 && (
              <m.span
                key={unread}
                initial={{ scale: 0.4 }}
                animate={{ scale: 1 }}
                transition={spring.stamp}
                className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--no)] px-1 font-mono text-[11px] font-semibold text-white ring-2 ring-[var(--bg)]"
              >
                {unread > 9 ? "9+" : unread}
              </m.span>
            )}
          </m.button>
        </m.header>

        {/* 2 · Verify */}
        <m.div className="mt-6" {...(intro ? riseIn(1, reduced) : {})}>
          <BigButton
            icon={<ShieldCheck size={32} weight="duotone" />}
            label={t("home.verify")}
            hint={verifiable.length === 0 ? t("home.needMember") : t("home.verifyHint")}
            onClick={() => navigate("/verify/who")}
          />
        </m.div>

        {/* 3 · Recent check (within 10 minutes) */}
        {recent?.request && (
          <m.button
            type="button"
            {...riseIn(2, reduced)}
            whileTap={{ scale: 0.985 }}
            onClick={async () => {
              const id = await checkAgain(recent.requestId);
              if (id) navigate(`/verify/waiting/${id}`);
            }}
            className="mt-3 flex min-h-14 w-full items-center gap-3 rounded-full bg-surface py-2 pl-2 pr-4 text-left shadow-[var(--shadow-1),inset_0_0_0_1px_var(--line)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
          >
            {(() => {
              const m2 = family?.find((f) => f.id === recent.memberId);
              return m2 ? <Avatar name={m2.label} color={m2.color} size={36} /> : null;
            })()}
            <span className="min-w-0 flex-1 truncate text-body-sm text-ink-2">
              {t("home.recent", {
                name: recent.memberLabel,
                what: reasonLabel(t, recent.request.reason, recent.request.amountInr),
              })}
            </span>
            <span className="shrink-0 text-body-sm font-semibold text-brand-ink">{t("home.checkAgain")}</span>
          </m.button>
        )}

        {/* 4 · A request is waiting for me */}
        {firstPending && pendingAsker && (
          <m.button
            type="button"
            {...riseIn(2, reduced)}
            whileTap={{ scale: 0.985 }}
            onClick={() => navigate(`/request/${firstPending.requestId}`)}
            className="mt-3 flex min-h-16 w-full items-center gap-3 rounded-[18px] bg-[#0A0E1F] px-4 py-3 text-left text-[#EEF0FF] shadow-[0_14px_30px_-16px_rgba(10,14,31,0.7)]"
          >
            <span className="relative grid h-10 w-10 place-items-center rounded-full bg-white/10">
              <span className="absolute inset-0 animate-ping rounded-full bg-[#8C95FF]/30" />
              <BellRinging size={22} weight="fill" className="relative text-[#B3B9FF]" />
            </span>
            <span className="min-w-0 flex-1 text-body font-semibold">
              {t("home.incoming", { asker: pendingAsker })}
            </span>
            <span className="inline-flex items-center gap-1 text-body-sm font-semibold text-[#B3B9FF]">
              {t("home.incomingCta")} <ArrowRight size={16} weight="bold" />
            </span>
          </m.button>
        )}

        {/* 5 · Alerts */}
        {unreadAlerts.length > 0 && (
          <section className="mt-8">
            <div className="mb-3 flex items-end justify-between">
              <h2 className="font-display text-h3 font-semibold text-ink">{t("home.alerts")}</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate("/alerts")}>
                {t("common.seeAll")}
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              {unreadAlerts.map((a, i) => (
                <m.div key={a.id} {...riseIn(i + 3, reduced)}>
                  <AlertCard alert={a} family={family} />
                </m.div>
              ))}
            </div>
          </section>
        )}

        {/* 6 · Your family */}
        <m.section className="mt-8" {...(intro ? riseIn(3, reduced) : {})}>
          <h2 className="mb-3 font-display text-h3 font-semibold text-ink">{t("home.family")}</h2>
          {family && family.length === 0 ? (
            <EmptyState
              illustration={<FamilyIllustration />}
              text={t("home.empty")}
              action={
                <Button full onClick={() => navigate("/family/add")} icon={<Plus size={20} weight="bold" />}>
                  {t("home.addFamily")}
                </Button>
              }
            />
          ) : (
            <div className="card py-4">
              <div className="scroll-x flex gap-1 px-3" role="list">
                {family?.map((mem, i) => (
                  <m.button
                    key={mem.id}
                    role="listitem"
                    type="button"
                    onClick={() => navigate(`/family/${mem.id}`)}
                    whileTap={{ scale: 0.94 }}
                    {...(intro ? riseIn(i, reduced, 0.2) : {})}
                    className="flex w-[76px] shrink-0 flex-col items-center gap-2 rounded-[18px] px-1 py-1.5 active:bg-surface-2"
                  >
                    <Avatar
                      name={mem.label}
                      color={mem.color}
                      size={56}
                      reachable={reachable.includes(mem.deviceId)}
                      layoutId={`avatar-${mem.id}`}
                    />
                    <span className="w-full truncate text-center text-body-sm font-medium text-ink">{mem.label}</span>
                  </m.button>
                ))}
                <m.button
                  type="button"
                  onClick={() => navigate("/family/add")}
                  whileTap={{ scale: 0.94 }}
                  className="flex w-[76px] shrink-0 flex-col items-center gap-2 rounded-[18px] px-1 py-1.5 active:bg-surface-2"
                  aria-label={t("family.add")}
                >
                  <span className="grid h-14 w-14 place-items-center rounded-full border-[1.5px] border-dashed border-brand bg-brand-soft/50 text-brand-ink">
                    <Plus size={24} weight="bold" />
                  </span>
                  <span className="text-body-sm font-medium text-brand-ink">{t("home.addTile")}</span>
                </m.button>
              </div>
            </div>
          )}
        </m.section>

        {/* 7 · Family rule */}
        <m.div className={cn("card relative mt-6 overflow-hidden p-4")} {...(intro ? riseIn(4, reduced) : {})}>
          <span aria-hidden className="hairline-brass absolute inset-x-6 top-0" />
          <div className="flex items-center gap-3">
            <Seal size={32} />
            <p className="min-w-0 flex-1 font-display text-h3 font-semibold text-ink">{t("home.rule")}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/help/how-it-works")}
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 pl-11 text-body-sm font-semibold text-brand-ink"
          >
            {t("home.howItWorks")} <ArrowRight size={16} weight="bold" aria-hidden />
          </button>
        </m.div>
      </PageBody>
    </PullToRefresh>
  );
}
