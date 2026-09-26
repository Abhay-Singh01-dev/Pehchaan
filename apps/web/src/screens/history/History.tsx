// H1 · History (spec B12 H1): "My checks" / "Asked of me" (sliding indicator), grouped by day,
// pull to refresh (the seal rotates with the pull and presses on release), tap a row → H2.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { ClockCounterClockwise, CaretRight } from "@phosphor-icons/react";
import type { HistoryEvent } from "@/services/types";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Segmented } from "@/components/controls";
import { DecisionChip, VerdictChip, Chip } from "@/components/VerdictChip";
import { PageBody } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useHistory } from "@/store/history";
import { useFamily } from "@/store/family";
import { useG } from "@/app/i18n";
import { useReduced } from "@/app/session";
import { dayKey, formatDateShort, formatINR, formatTime } from "@/lib/format";
import { riseIn, dur } from "@/design/motion";

export function History() {
  const { t, lang } = useG();
  const navigate = useNavigate();
  const reduced = useReduced();
  const [tab, setTab] = useState<"checked" | "answered">("checked");
  const events = useHistory(tab);
  const family = useFamily();
  const [, force] = useState(0);

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: HistoryEvent[] }> = [];
    for (const e of events ?? []) {
      const k = dayKey(e.at);
      const key = String(k);
      const label =
        k === "today" ? t("common.today") : k === "yesterday" ? t("common.yesterday") : formatDateShort(k, lang);
      const g = out.find((x) => x.key === key);
      if (g) g.items.push(e);
      else out.push({ key, label, items: [e] });
    }
    return out;
  }, [events, lang, t]);

  let idx = 0;

  return (
    <PullToRefresh
      onRefresh={async () => {
        await new Promise((r) => setTimeout(r, 700));
        force((n) => n + 1);
      }}
    >
      <TopBar hideBack title={t("history.title")} />
      <PageBody withTabBar>
        <m.h1 className="mb-5 font-display text-h1 font-semibold text-ink" {...riseIn(0, reduced)}>
          {t("history.title")}
        </m.h1>
        <Segmented
          id="history"
          label={t("history.title")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "checked", label: t("history.mine") },
            { value: "answered", label: t("history.asked") },
          ]}
        />

        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={tab}
            className="mt-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur.fast }}
          >
            {events && events.length === 0 ? (
              <EmptyState
                illustration={<ClockCounterClockwise size={56} weight="duotone" className="text-brand" />}
                text={t("history.empty")}
              />
            ) : (
              groups.map((g) => (
                <section key={g.key} className="mb-6">
                  <h2 className="mb-2 px-1 text-caption font-medium uppercase tracking-[0.06em] text-muted">
                    {g.label}
                  </h2>
                  <div className="card divide-y divide-line overflow-hidden">
                    {g.items.map((e) => {
                      const member = family?.find((mm) => mm.deviceId === e.memberDeviceId);
                      const name =
                        e.verdict === "UNKNOWN_PERSON" && !e.personLabel
                          ? t("verify.someone")
                          : (member?.label ?? e.personLabel);
                      const i = idx++;
                      return (
                        <m.button
                          key={e.id}
                          type="button"
                          onClick={() => navigate(`/history/${e.id}`)}
                          whileTap={{ scale: 0.985 }}
                          {...riseIn(i, reduced)}
                          className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
                        >
                          <Avatar name={name} color={member?.color ?? "slate"} size={40} />
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-body font-semibold text-ink">
                              {e.kind === "checked" ? t("history.checked", { name }) : t("history.answered", { name })}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-caption text-muted">
                              {e.amountInr ? (
                                <span className="font-mono font-semibold text-ink-2">{formatINR(e.amountInr)}</span>
                              ) : null}
                              {e.amountInr ? <span aria-hidden>·</span> : null}
                              <span>{formatTime(e.at, lang)}</span>
                            </span>
                          </span>
                          {e.verdict ? (
                            <VerdictChip verdict={e.verdict} />
                          ) : e.decision ? (
                            <DecisionChip decision={e.decision} />
                          ) : e.cancelled ? (
                            <Chip tone="neutral">{t("history.cancelled")}</Chip>
                          ) : null}
                          <CaretRight size={16} className="shrink-0 text-muted" aria-hidden />
                        </m.button>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </m.div>
        </AnimatePresence>
      </PageBody>
    </PullToRefresh>
  );
}
