// H2 · History detail (spec B12 H2): a summary card in the verdict colour (small seal, headline,
// amount, reason), a timeline (Asked → Answered → Result), the ChecksList (it draws once, on the
// first view; static afterwards) and "Delete this entry" (InlineConfirm).
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import * as m from "motion/react-m";
import { Trash } from "@phosphor-icons/react";
import { Seal, type SealState } from "@/components/Seal";
import { ChecksList } from "@/components/ChecksList";
import { InlineConfirm } from "@/components/InlineConfirm";
import { Button } from "@/components/Button";
import { DecisionChip } from "@/components/VerdictChip";
import { PageBody, Section } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { deleteHistory, markHistoryViewed, useHistoryEvent } from "@/store/history";
import { useFamily } from "@/store/family";
import { useG } from "@/app/i18n";
import { toast } from "@/app/ui";
import { useReduced } from "@/app/session";
import { formatClock, formatDateLong, formatINR } from "@/lib/format";
import { reasonLabel } from "@/lib/labels";
import { riseIn } from "@/design/motion";
import { cn } from "@/lib/cn";
import type { Verdict } from "@/services/types";
import { PageSkeleton } from "@/components/Skeleton";

const SEAL: Record<Verdict, SealState> = {
  VERIFIED: "confirmed",
  DENIED: "denied",
  INVALID: "fake",
  NO_RESPONSE: "clock",
  UNKNOWN_PERSON: "unknown",
};
const BG: Record<Verdict, string> = {
  VERIFIED: "v-ok",
  DENIED: "v-no",
  INVALID: "v-fake hatch",
  NO_RESPONSE: "v-amber",
  UNKNOWN_PERSON: "v-amber",
};

export function HistoryDetail() {
  const { eventId } = useParams();
  const { t, lang } = useG();
  const navigate = useNavigate();
  const reduced = useReduced();
  const event = useHistoryEvent(eventId);
  const family = useFamily();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Decide once, on arrival, whether the checks animate (first view only).
  const firstView = useRef<boolean | null>(null);
  if (event && firstView.current === null) firstView.current = !event.viewed;
  useEffect(() => {
    if (event && !event.viewed) void markHistoryViewed(event.id);
  }, [event]);

  if (event === null) return <Navigate to="/history" replace />;
  if (!event) return <PageSkeleton />;

  const member = family?.find((mm) => mm.deviceId === event.memberDeviceId);
  const name = event.verdict === "UNKNOWN_PERSON" && !event.personLabel ? t("verify.someone") : member?.label ?? event.personLabel;
  const amber = event.verdict === "NO_RESPONSE" || event.verdict === "UNKNOWN_PERSON";

  const headline = event.verdict
    ? {
        VERIFIED: t("v.ok.title"),
        DENIED: t("v.denied.title", { name }),
        INVALID: t("v.fake.title"),
        NO_RESPONSE: t("v.none.title"),
        UNKNOWN_PERSON: t("v.unknown.title"),
      }[event.verdict]
    : event.kind === "answered"
      ? t("history.answered", { name })
      : t("history.cancelled");

  const timeline = [
    event.askedAt ? { label: t("historyDetail.asked"), at: event.askedAt } : null,
    event.answeredAt ? { label: event.kind === "answered" ? t("historyDetail.yourAnswer") : t("historyDetail.answered"), at: event.answeredAt } : null,
    { label: event.cancelled ? t("historyDetail.cancelledAt") : t("historyDetail.result"), at: event.at },
  ].filter(Boolean) as Array<{ label: string; at: number }>;

  return (
    <>
      <TopBar title={t("historyDetail.title")} titleAlways />
      <PageBody className="pt-2">
        {/* Summary card */}
        <m.div
          className={cn(
            "relative overflow-hidden rounded-[24px] p-5",
            event.verdict ? BG[event.verdict] : "card",
          )}
          {...riseIn(0, reduced)}
        >
          <div className="flex items-center gap-4">
            {event.verdict ? (
              <Seal size={56} state={SEAL[event.verdict]} tone={amber ? "dark" : "light"} />
            ) : (
              <Seal size={56} />
            )}
            <div className="min-w-0">
              <p className={cn("font-display text-h2 font-semibold", !event.verdict && "text-ink")}>{headline}</p>
              <p className={cn("mt-0.5 text-body-sm", event.verdict ? "opacity-90" : "text-ink-2")}>
                {event.kind === "checked" ? t("history.checked", { name }) : t("history.answered", { name })}
              </p>
            </div>
          </div>
          <div className={cn("mt-4 flex flex-wrap items-center gap-2 text-body-sm", event.verdict ? "" : "text-ink-2")}>
            {event.amountInr ? <span className="font-mono text-mono-lg font-semibold">{formatINR(event.amountInr)}</span> : null}
            <span className={cn("rounded-full px-3 py-1 font-semibold", event.verdict ? "bg-black/[0.12]" : "bg-surface-2")}>
              {reasonLabel(t, event.reason)}
            </span>
            {event.decision && <DecisionChip decision={event.decision} />}
          </div>
          {event.invalidReason && (
            <p className="mt-3 text-body-sm font-semibold">{t(`v.reasons.${event.invalidReason}`, { name })}</p>
          )}
        </m.div>

        {/* Timeline */}
        <Section title={t("historyDetail.timeline")}>
          <m.ol className="card p-4" {...riseIn(1, reduced)}>
            <p className="mb-3 text-caption text-muted">{formatDateLong(event.at, lang)}</p>
            {timeline.map((s, i) => (
              <li key={s.label} className="relative flex items-center gap-3 pb-4 last:pb-0">
                {i < timeline.length - 1 && <span aria-hidden className="absolute left-[7px] top-4 h-full w-0.5 bg-line" />}
                <span className={cn("relative h-4 w-4 shrink-0 rounded-full", i === timeline.length - 1 ? "bg-brand" : "bg-surface-2 shadow-[inset_0_0_0_2px_var(--brand)]")} />
                <span className="flex-1 text-body font-medium text-ink">{s.label}</span>
                <span className="font-mono text-body-sm font-medium tabular-nums text-ink-2">{formatClock(s.at)}</span>
              </li>
            ))}
          </m.ol>
        </Section>

        {/* The 7 checks */}
        <Section title={t("historyDetail.checks")}>
          {event.checks && event.checks.length ? (
            <div className="card p-2">
              <ChecksList checks={event.checks} name={name} animate={Boolean(firstView.current)} />
            </div>
          ) : (
            <p className="card p-4 text-body-sm text-muted">{t("historyDetail.noChecks")}</p>
          )}
        </Section>

        <div className="mt-8">
          {!confirmDelete && (
            <Button full variant="danger-outline" icon={<Trash size={20} />} onClick={() => setConfirmDelete(true)}>
              {t("historyDetail.delete")}
            </Button>
          )}
          <InlineConfirm
            open={confirmDelete}
            danger
            message={t("historyDetail.deleteConfirm")}
            confirmLabel={t("historyDetail.deleteCta")}
            cancelLabel={t("common.cancel")}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={async () => {
              navigate("/history", { replace: true });
              await deleteHistory(event.id);
              toast(t("historyDetail.deleted"), { tone: "success" });
            }}
          />
        </div>
      </PageBody>
    </>
  );
}
