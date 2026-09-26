// C6 · Member details (spec B12 C6) and C7 · Remove (in-page InlineConfirm).
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import * as m from "motion/react-m";
import { CaretRight, PencilSimple, ShieldCheck, Trash, UsersThree } from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { ChipGroup, TextField } from "@/components/controls";
import { InlineConfirm } from "@/components/InlineConfirm";
import { ListGroup, ListRow } from "@/components/List";
import { RoleBadge } from "@/components/Member";
import { PhoneNumber } from "@/components/PhoneNumber";
import { SafetyWords } from "@/components/SafetyWords";
import { VerdictChip } from "@/components/VerdictChip";
import { PageBody, Section } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { removeMember, updateMember, useMember } from "@/store/family";
import { useMemberHistory } from "@/store/history";
import { useG } from "@/app/i18n";
import { toast } from "@/app/ui";
import { useReachable, useReduced } from "@/app/session";
import { formatDateLong, relativeTime } from "@/lib/format";
import { reasonLabel } from "@/lib/labels";
import { riseIn } from "@/design/motion";
import { RELATIONS } from "./ConfirmMember";
import { PageSkeleton } from "@/components/Skeleton";

export function MemberDetail() {
  const { memberId } = useParams();
  const { t, lang } = useG();
  const navigate = useNavigate();
  const member = useMember(memberId);
  const recent = useMemberHistory(member?.deviceId);
  const reachable = useReachable();
  const reduced = useReduced();
  const [editing, setEditing] = useState<"rename" | "relation" | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (member === undefined) return <PageSkeleton />;
  if (member === null) {
    return (
      <>
        <TopBar backTo="/family" />
        <PageBody>
          <p className="text-body text-ink-2">{t("member.notFound")}</p>
        </PageBody>
      </>
    );
  }

  const added = formatDateLong(member.addedAt, lang);
  const isReachable = reachable.includes(member.deviceId);

  return (
    <>
      <TopBar title={member.label} backTo="/family" />
      <PageBody>
        {/* Header (shared-element avatar from the list) */}
        <div className="flex flex-col items-center text-center">
          <Avatar
            name={member.label}
            color={member.color}
            size={88}
            reachable={isReachable}
            showPresence
            layoutId={`avatar-${member.id}`}
          />
          <m.h1 className="mt-4 font-display text-h1 font-semibold text-ink" {...riseIn(1, reduced)}>
            {member.label}
          </m.h1>
          <m.div className="mt-1 flex items-center gap-2" {...riseIn(2, reduced)}>
            <span className="text-body text-ink-2">{t(`relation.${member.relation}`)}</span>
            <RoleBadge canBeVerified={member.canBeVerified} />
          </m.div>
        </div>

        {/* Actions */}
        <m.div className="mt-6 flex flex-col gap-3" {...riseIn(3, reduced)}>
          {member.canBeVerified && (
            <Button
              full
              icon={<ShieldCheck size={22} weight="duotone" />}
              onClick={() => navigate("/verify/what", { state: { memberId: member.id } })}
            >
              {t("member.verify")}
            </Button>
          )}
          {member.phone && <PhoneNumber number={member.phone} label={t("alerts.call", { name: member.label })} />}
        </m.div>

        {/* Info */}
        <m.div {...riseIn(4, reduced)}>
          <Section title={t("member.words")}>
            <SafetyWords words={member.safetyWords} flip={false} />
          </Section>
        </m.div>
        <m.div className="mt-4" {...riseIn(5, reduced)}>
          <ListGroup>
            <ListRow
              label={t("member.addedOn")}
              sub={
                member.addedBy === "in_person"
                  ? t("member.addedInPerson", { date: added })
                  : t("member.addedByLink", { date: added })
              }
            />
            <ListRow label={t("member.key")} sub={member.canBeVerified ? t("member.keyYes") : t("member.keyNo")} />
            {!member.phone && <ListRow label={t("member.phone")} sub={t("member.noPhone")} />}
          </ListGroup>
        </m.div>

        {/* Recent checks */}
        <Section title={t("member.recent")}>
          {recent && recent.length > 0 ? (
            <div className="card divide-y divide-line overflow-hidden">
              {recent.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => navigate(`/history/${e.id}`)}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-body font-medium text-ink">
                      {e.kind === "answered"
                        ? t("history.answered", { name: e.personLabel })
                        : reasonLabel(t, e.reason, e.amountInr)}
                    </span>
                    <span className="block text-caption text-muted">{relativeTime(e.at, lang)}</span>
                  </span>
                  {e.verdict ? (
                    <VerdictChip verdict={e.verdict} />
                  ) : e.cancelled ? (
                    <span className="text-caption text-muted">{t("history.cancelled")}</span>
                  ) : null}
                  <CaretRight size={16} className="text-muted" aria-hidden />
                </button>
              ))}
            </div>
          ) : (
            <p className="card px-4 py-4 text-body-sm text-muted">{t("member.recentEmpty", { name: member.label })}</p>
          )}
        </Section>

        {/* Manage */}
        <Section title={t("member.manage")}>
          <ListGroup>
            <ListRow
              icon={<PencilSimple size={20} />}
              label={t("member.rename")}
              value={member.label}
              chevron
              onClick={() => {
                setDraftLabel(member.label);
                setEditing(editing === "rename" ? null : "rename");
              }}
            />
            {editing === "rename" && (
              <div className="px-4 py-4">
                <TextField
                  label={t("member.renameLabel")}
                  value={draftLabel}
                  onChange={(v) => setDraftLabel(v.slice(0, 30))}
                  autoFocus
                  maxLength={30}
                />
                <Button
                  className="mt-3"
                  size="md"
                  full
                  disabled={!draftLabel.trim()}
                  onClick={async () => {
                    await updateMember(member.id, { label: draftLabel.trim() });
                    setEditing(null);
                    toast(t("member.saved"), { tone: "success" });
                  }}
                >
                  {t("common.save")}
                </Button>
              </div>
            )}
            <ListRow
              icon={<UsersThree size={20} />}
              label={t("member.changeRelation")}
              value={t(`relation.${member.relation}`)}
              chevron
              onClick={() => setEditing(editing === "relation" ? null : "relation")}
            />
            {editing === "relation" && (
              <div className="px-4 py-4">
                <ChipGroup
                  label={t("member.changeRelation")}
                  size="sm"
                  value={member.relation}
                  onChange={async (r) => {
                    await updateMember(member.id, { relation: r });
                    setEditing(null);
                    toast(t("member.saved"), { tone: "success" });
                  }}
                  options={RELATIONS.map((r) => ({ value: r, label: t(`relation.${r}`) }))}
                />
              </div>
            )}
            {!confirmRemove && (
              <ListRow
                icon={<Trash size={20} />}
                label={t("member.remove")}
                danger
                onClick={() => setConfirmRemove(true)}
              />
            )}
          </ListGroup>
          <InlineConfirm
            className="mt-3"
            open={confirmRemove}
            danger
            message={t("member.removeConfirm", { label: member.label })}
            confirmLabel={t("common.remove")}
            cancelLabel={t("common.cancel")}
            onCancel={() => setConfirmRemove(false)}
            onConfirm={async () => {
              const label = member.label;
              navigate("/family", { replace: true });
              await removeMember(member.id);
              toast(t("member.removed", { label }), { tone: "success" });
            }}
          />
        </Section>
      </PageBody>
    </>
  );
}
