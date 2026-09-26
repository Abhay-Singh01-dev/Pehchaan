// C5 · Confirm and label (spec B12 C5). Receives the decoded card via navigation state.
//   - the avatar (88) grows in from the scan position
//   - "Does {name}'s phone show these words?" → Yes / No
//   - on Yes: relation chips + an editable label (mother → "Maa") + Save
//   - Save: success haptic, the avatar flies to the Family tab, toast "{label} added", then a
//     sheet "Now let {label} scan your code so you can verify each other"
//   - No: "Don't add this person. Scan again, face to face."
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { ArrowCounterClockwise, WarningOctagon } from "@phosphor-icons/react";
import { services } from "@/services";
import type { FamilyCard, FamilyMember, Relation } from "@/services/types";
import { CardWarning, isBlocked, type CardBlock } from "@/components/CardWarning";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { ChipGroup, TextField } from "@/components/controls";
import { RoleBadge } from "@/components/Member";
import { SafetyWords } from "@/components/SafetyWords";
import { Sheet } from "@/components/Sheet";
import { BottomActions, PageBody } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { AlreadyInFamilyError, addMember, listFamily, suggestLabel } from "@/store/family";
import { queueContactOp } from "@/app/contacts";
import { toast } from "@/app/ui";
import { useReduced } from "@/app/session";
import { haptic } from "@/design/haptics";
import { dur, ease, riseIn, spring } from "@/design/motion";
import { frameRect, type Point } from "@/design/origin";

export const RELATIONS: Relation[] = [
  "son",
  "daughter",
  "mother",
  "father",
  "husband",
  "wife",
  "brother",
  "sister",
  "grandchild",
  "other",
];

export function ConfirmMember() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const reduced = useReduced();
  const state = location.state as { card?: FamilyCard; origin?: Point } | null;
  const card = state?.card;
  const [step, setStep] = useState<"words" | "label" | "mismatch">("words");
  const [relation, setRelation] = useState<Relation | null>(null);
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flying, setFlying] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [block, setBlock] = useState<CardBlock | null>(null);

  const firstName = useMemo(() => card?.name.split(/\s+/)[0] ?? "", [card]);
  const origin = state?.origin;

  if (!card) {
    return (
      <>
        <TopBar title={t("confirm.title")} />
        <PageBody>
          <p className="text-body text-ink-2">{t("confirm.noCard")}</p>
          <Button className="mt-6" full onClick={() => navigate("/family/scan", { replace: true })}>
            {t("confirm.scanAgain")}
          </Button>
        </PageBody>
      </>
    );
  }

  const shownLabel = label.trim() || firstName;

  const save = async () => {
    if (!relation) return;
    setSaving(true);
    // The family may have changed since the scan: guard again, right before saving (6.5).
    const guard = services.card.guard(card, await listFamily());
    if (guard.kind !== "new") {
      setSaving(false);
      haptic("error");
      if (isBlocked(guard)) setBlock(guard);
      else toast(t("scan.already", { name: guard.member.label }));
      return;
    }
    let member: FamilyMember;
    try {
      member = await addMember(card, { label: shownLabel, relation, addedBy: "in_person" });
    } catch (e) {
      setSaving(false);
      if (e instanceof AlreadyInFamilyError) return void toast(t("scan.already", { name: e.member.label }));
      throw e;
    }
    // Added face to face: lift any earlier block on this device (6.4, FC-19). Queued, so offline is fine.
    void queueContactOp("unrevoke", card.deviceId);
    haptic("success");
    setFlying(true);
    window.setTimeout(
      () => {
        toast(t("confirm.added", { label: member.label }), { tone: "success" });
        setSheet(member.label);
        setSaving(false);
      },
      reduced ? 100 : 650,
    );
  };

  // Avatar entrance: grows from where the code was found (positions relative to the phone frame).
  const frame = frameRect();
  const fromScan =
    origin && !reduced
      ? { x: origin.x - (frame.left + frame.width / 2), y: origin.y - frame.top - 170, scale: 0.3, opacity: 0 }
      : { opacity: 0, scale: reduced ? 1 : 0.8 };

  return (
    <>
      <TopBar title={t("confirm.title")} />
      <PageBody>
        <div className="flex flex-col items-center text-center">
          <m.div
            initial={fromScan}
            animate={
              flying
                ? { x: -frame.width * 0.14, y: frame.height - 200, scale: 0.28, opacity: 0 }
                : { x: 0, y: 0, scale: 1, opacity: 1 }
            }
            transition={flying ? { duration: 0.6, ease: ease.inOut } : spring.soft}
          >
            <Avatar name={shownLabel} color={card.color} size={88} />
          </m.div>
          <m.h1 className="mt-4 font-display text-h1 font-semibold text-ink" {...riseIn(1, reduced)}>
            {card.name}
          </m.h1>
          <m.div className="mt-2" {...riseIn(2, reduced)}>
            <RoleBadge canBeVerified={card.canBeVerified} />
          </m.div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {step === "words" && (
            <m.section
              key="words"
              className="mt-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: reduced ? 0 : -8 }}
              transition={{ duration: dur.base }}
            >
              <p className="mb-3 text-center font-display text-h3 font-semibold text-ink">
                {t("family.wordsAsk", { name: firstName })}
              </p>
              <SafetyWords words={card.safetyWords} size="lg" delay={0.3} />
            </m.section>
          )}

          {step === "mismatch" && (
            <m.section
              key="mismatch"
              className="mt-8 rounded-[18px] p-5 shadow-[inset_0_0_0_1.5px_var(--chip-no)]"
              style={{ background: "color-mix(in oklab, var(--no) 8%, var(--surface))" }}
              initial={{ opacity: 0, y: reduced ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="alert"
            >
              <WarningOctagon size={32} weight="duotone" className="text-chip-no" aria-hidden />
              <p className="mt-2 font-display text-h3 font-semibold text-ink">{t("confirm.noPanel")}</p>
            </m.section>
          )}

          {step === "label" && (
            <m.section
              key="label"
              className="mt-8 flex flex-col gap-6"
              initial={{ opacity: 0, y: reduced ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: dur.base, ease: ease.out }}
            >
              <div>
                <p className="mb-3 font-display text-h3 font-semibold text-ink">
                  {t("confirm.relationQ", { name: firstName })}
                </p>
                <ChipGroup
                  label={t("confirm.relationQ", { name: firstName })}
                  value={relation}
                  onChange={(r) => {
                    setRelation(r);
                    if (!labelTouched) setLabel(suggestLabel(card.name, r, i18n.language === "hi" ? "hi" : "en"));
                  }}
                  options={RELATIONS.map((r) => ({ value: r, label: t(`relation.${r}`) }))}
                />
              </div>
              <TextField
                label={t("confirm.label")}
                value={label}
                onChange={(v) => {
                  setLabel(v.slice(0, 30));
                  setLabelTouched(true);
                }}
                placeholder={firstName}
                hint={t("confirm.labelHint")}
                maxLength={30}
              />
            </m.section>
          )}
        </AnimatePresence>

        <BottomActions>
          {step === "words" && (
            <>
              <Button full onClick={() => setStep("label")}>
                {t("family.wordsYes")}
              </Button>
              <Button
                full
                variant="secondary"
                onClick={() => {
                  haptic("error");
                  setStep("mismatch");
                }}
              >
                {t("common.no")}
              </Button>
            </>
          )}
          {step === "mismatch" && (
            <Button
              full
              icon={<ArrowCounterClockwise size={20} />}
              onClick={() => navigate("/family/scan", { replace: true })}
            >
              {t("confirm.scanAgain")}
            </Button>
          )}
          {step === "label" && (
            <Button full disabled={!relation} loading={saving} onClick={save}>
              {t("common.save")}
            </Button>
          )}
        </BottomActions>
      </PageBody>

      <Sheet open={sheet !== null} onClose={() => navigate("/family", { replace: true })} labelledBy="scan-back-title">
        <h2 id="scan-back-title" className="font-display text-h2 font-semibold text-ink">
          {t("confirm.sheetTitle", { label: sheet ?? "" })}
        </h2>
        <div className="mt-5 flex flex-col gap-2.5">
          <Button full onClick={() => navigate("/family/my-code", { replace: true })}>
            {t("confirm.sheetShow")}
          </Button>
          <Button full variant="ghost" onClick={() => navigate("/family", { replace: true })}>
            {t("confirm.sheetNotNow")}
          </Button>
        </div>
      </Sheet>

      {block && <CardWarning block={block} onDontAdd={() => navigate("/family", { replace: true })} />}
    </>
  );
}
