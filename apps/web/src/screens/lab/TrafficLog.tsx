// J1 · Traffic log: every RelayEvent with time, from → to, kind, summary, a tampered tag and the
// verdict seen. Newest first, virtualised so long sessions stay smooth.
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import type { PeerInfo, RelayEvent } from "@/services/types";
import { Chip, VerdictChip } from "@/components/VerdictChip";
import { formatClock } from "@/lib/format";

const COLS = "grid grid-cols-[88px_minmax(150px,1.1fr)_84px_minmax(220px,2.4fr)_96px_132px] items-center gap-3";

export function TrafficLog({ events, peers }: { events: RelayEvent[]; peers: PeerInfo[] }) {
  const { t } = useTranslation();
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: events.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 52,
    overscan: 8,
  });
  const name = (id: string) => {
    if (id === "relay") return t("lab.relay");
    const p = peers.find((x) => x.deviceId === id);
    return p?.name?.split(/\s+/)[0] || id;
  };

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className={`${COLS} border-b border-line px-4 py-3 text-caption font-semibold uppercase tracking-[0.06em] text-muted`}>
            <span>{t("lab.time")}</span>
            <span>{t("lab.route")}</span>
            <span>{t("lab.kind")}</span>
            <span>{t("lab.summary")}</span>
            <span>{t("lab.tampered")}</span>
            <span>{t("lab.verdictSeen")}</span>
          </div>
          {events.length === 0 ? (
            <p className="px-4 py-8 text-center text-body-sm text-muted">{t("lab.empty")}</p>
          ) : (
            <div ref={parent} className="h-[420px] overflow-y-auto" role="table" aria-label={t("lab.traffic")}>
              <div style={{ height: v.getTotalSize(), position: "relative" }}>
                {v.getVirtualItems().map((row) => {
                  const e = events[row.index]!;
                  return (
                    <div
                      key={e.id + row.index}
                      role="row"
                      className={`${COLS} absolute inset-x-0 border-b border-line px-4 text-body-sm ${e.tampered ? "bg-[color-mix(in_oklab,var(--no)_8%,transparent)]" : ""}`}
                      style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                    >
                      <span className="font-mono text-caption text-muted tabular-nums">{formatClock(e.at)}</span>
                      <span className="truncate font-medium text-ink">
                        {name(e.from)} <span className="text-muted">→</span> {name(e.to)}
                      </span>
                      <span className="font-mono text-caption text-ink-2">{t(`lab.kinds.${e.kind}`)}</span>
                      <span className="truncate font-mono text-caption text-ink-2" title={e.summary}>
                        {e.summary}
                      </span>
                      <span>{e.tampered ? <Chip tone="fake">{t(`lab.attackNames.${e.tampered}`)}</Chip> : null}</span>
                      <span>{e.verdictSeen ? <VerdictChip verdict={e.verdictSeen} /> : null}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
