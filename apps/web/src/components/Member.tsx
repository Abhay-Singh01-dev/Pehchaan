// MemberTile (grids: D1) and MemberRow (lists: C1), plus the role badge.
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import type { FamilyMember } from "@/services/types";
import { Avatar } from "./Avatar";
import { riseIn } from "@/design/motion";
import { useReduced } from "@/app/session";
import { formatDateShort } from "@/lib/format";
import { useG } from "@/app/i18n";
import { cn } from "@/lib/cn";

export function RoleBadge({ canBeVerified, className }: { canBeVerified: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2 text-caption font-medium",
        canBeVerified ? "bg-brand-soft text-brand-ink" : "bg-surface-2 text-muted",
        className,
      )}
    >
      {canBeVerified ? t("family.canBeVerified") : t("family.checksOnly")}
    </span>
  );
}

export function MemberTile({
  member,
  reachable,
  onClick,
  index = 0,
}: {
  member: FamilyMember;
  reachable: boolean;
  onClick: () => void;
  index?: number;
}) {
  const { t } = useTranslation();
  const reduced = useReduced();
  return (
    <m.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      {...riseIn(index, reduced, 0.06)}
      className="card flex min-h-[148px] flex-col items-center justify-center gap-2.5 p-4 text-center active:bg-surface-2"
    >
      <Avatar
        name={member.label}
        color={member.color}
        size={56}
        reachable={reachable}
        layoutId={`avatar-${member.id}`}
      />
      <span className="w-full min-w-0">
        <span className="block truncate font-display text-h3 font-semibold text-ink">{member.label}</span>
        <span className="block truncate text-body-sm text-muted">{t(`relation.${member.relation}`)}</span>
      </span>
    </m.button>
  );
}

export function MemberRow({
  member,
  reachable,
  onClick,
  index = 0,
}: {
  member: FamilyMember;
  reachable: boolean;
  onClick: () => void;
  index?: number;
}) {
  const { t, lang } = useG();
  const reduced = useReduced();
  const date = formatDateShort(member.addedAt, lang);
  return (
    <m.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      {...riseIn(index, reduced)}
      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left active:bg-surface-2"
    >
      <Avatar
        name={member.label}
        color={member.color}
        size={48}
        reachable={reachable}
        layoutId={`avatar-${member.id}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="break-words font-display text-h3 font-semibold text-ink">{member.label}</span>
          <span className="text-body-sm text-muted">· {t(`relation.${member.relation}`)}</span>
        </span>
        <span className="mt-0.5 block text-caption text-muted">
          {member.addedBy === "in_person" ? t("family.addedInPerson", { date }) : t("family.addedByLink", { date })}
        </span>
      </span>
      <RoleBadge canBeVerified={member.canBeVerified} className="hidden min-[380px]:inline-flex" />
    </m.button>
  );
}
