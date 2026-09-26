// C8 · Add from a family link (spec B12 C8): /join#c=… opened by scanning a QR with any phone
// camera. Someone (a judge, a relative) can check a person on their own phone in about a
// minute: no install and no key. A compact flow in one screen; the steps slide horizontally.
//   1  "{name} shared their Pehchaan card with you." (+ your name and language if new here)
//   2  the safety words: "Do these match the words on {name}'s phone?"
//   3  "Saved. You can now check {name} anytime." → Verify {name} now / Go to Home
// Creates a minimal checks-only profile (setupComplete) if none exists, stores the member with
// addedBy "family_link", and never asks to create a key. Words don't match → nothing is saved.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { CheckCircle, LinkBreak, WarningOctagon } from "@phosphor-icons/react";
import { services } from "@/services";
import { safetyWordsFor } from "@/services/words";
import { CardError, type FamilyCard, type FamilyMember, type Lang } from "@/services/types";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Segmented, TextField } from "@/components/controls";
import { RoleBadge } from "@/components/Member";
import { SafetyWords } from "@/components/SafetyWords";
import { Seal } from "@/components/Seal";
import { BottomActions, PageBody } from "@/components/screen/Page";
import { addMember, getMemberByDeviceId } from "@/store/family";
import { DEFAULT_PREFS, getPrefs, saveProfile, setPrefs, useProfile } from "@/store/profile";
import { setMeta } from "@/store/meta";
import { useSession, useReduced } from "@/app/session";
import { haptic } from "@/design/haptics";
import { dur, ease } from "@/design/motion";

type Parsed = { card: FamilyCard } | { error: "corrupt" | "not_pehchaan" | "own_card" | "old_browser" };

function parse(): Parsed {
  if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) return { error: "old_browser" };
  try {
    return { card: services.card.fromLink(window.location.href) };
  } catch (e) {
    return { error: e instanceof CardError ? e.code : "corrupt" };
  }
}

export function Join() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const profile = useProfile();
  const deviceId = useSession((s) => s.deviceId);
  const parsed = useMemo(parse, []);
  const [step, setStep] = useState<1 | 2 | 3 | "nomatch">(1);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<FamilyMember | null>(null);
  const [existing, setExisting] = useState<FamilyMember | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const card = "card" in parsed ? parsed.card : null;
  const first = card?.name.split(/\s+/)[0] ?? "";

  useEffect(() => {
    if (card) void getMemberByDeviceId(card.deviceId).then((m) => setExisting(m ?? null));
  }, [card]);

  const go = (s: typeof step) => {
    setDir(s === 1 ? -1 : 1);
    setStep(s);
  };

  const save = async () => {
    if (!card || !deviceId) return;
    setBusy(true);
    if (!profile) {
      const prefs = await getPrefs();
      await saveProfile({
        ...DEFAULT_PREFS,
        ...prefs,
        deviceId,
        name: name.trim() || t("join.guest"),
        color: "slate",
        role: "checks_only",
        safetyWords: await safetyWordsFor(`checks-only:${deviceId}`),
        createdAt: Date.now(),
        setupComplete: true,
      });
      await setMeta("installDismissed", true);
    }
    const member = await addMember(card, { label: first, relation: "other", addedBy: "family_link" });
    haptic("success");
    setSaved(member);
    setBusy(false);
    // Don't re-open this flow on reload.
    window.history.replaceState(window.history.state, "", "/join");
    go(3);
  };

  if (!card) {
    const err = "error" in parsed ? parsed.error : "corrupt";
    return (
      <PageBody noTopBar className="flex min-h-app flex-col">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-surface-2 text-ink-2">
            <LinkBreak size={40} weight="duotone" aria-hidden />
          </span>
          <p className="mt-6 max-w-[30ch] font-display text-h2 font-semibold text-ink" role="alert">
            {err === "old_browser"
              ? t("join.oldBrowser")
              : err === "own_card"
                ? t("join.own")
                : err === "not_pehchaan"
                  ? t("join.notPehchaan")
                  : t("join.corrupt")}
          </p>
        </div>
        <BottomActions>
          <Button full variant="secondary" onClick={() => navigate("/", { replace: true })}>
            {t("join.goHome")}
          </Button>
        </BottomActions>
      </PageBody>
    );
  }

  const stepNo = step === "nomatch" ? 2 : step;
  const slide = reduced ? 0 : 40;

  return (
    <PageBody noTopBar className="flex min-h-app flex-col">
      <div className="flex items-center justify-between">
        <Seal size={40} />
        <span className="font-mono text-caption font-semibold text-muted">{t("join.step", { n: stepNo })}</span>
      </div>

      <div className="relative mt-6 flex-1">
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <m.section
            key={String(step)}
            initial={{ x: dir * slide, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -dir * slide, opacity: 0 }}
            transition={{ duration: dur.slow, ease: ease.out }}
          >
            {step === 1 && (
              <>
                <div className="flex flex-col items-center text-center">
                  <Avatar name={card.name} color={card.color} size={88} />
                  <h1 className="mt-5 font-display text-h1 font-semibold text-ink">{t("join.shared", { name: card.name })}</h1>
                  <RoleBadge className="mt-3" canBeVerified={card.canBeVerified} />
                </div>
                {existing && (
                  <p className="card mt-6 flex items-center gap-3 p-4 text-body text-ink">
                    <CheckCircle size={24} weight="duotone" className="shrink-0 text-brand" aria-hidden />
                    {t("scan.already", { name: existing.label })}
                  </p>
                )}
                {!profile && profile !== undefined && !existing && (
                  <div className="mt-8 flex flex-col gap-5">
                    <TextField
                      label={t("join.yourName")}
                      value={name}
                      onChange={(v) => setName(v.slice(0, 30))}
                      placeholder={t("join.guest")}
                      hint={t("join.yourNameHint", { name: first })}
                      maxLength={30}
                    />
                    <div>
                      <div className="mb-2 text-body-sm font-medium text-ink-2">{t("join.language")}</div>
                      <Segmented
                        id="join-lang"
                        label={t("join.language")}
                        value={(i18n.language as Lang) ?? "en"}
                        onChange={(l) => void setPrefs({ lang: l })}
                        options={[
                          { value: "en", label: "English" },
                          { value: "hi", label: "हिन्दी" },
                        ]}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {step === 2 && (
              <div>
                <h1 className="font-display text-h1 font-semibold text-ink">{t("join.wordsAsk", { name: first })}</h1>
                <SafetyWords words={card.safetyWords} size="lg" className="mt-6" delay={0.15} />
              </div>
            )}

            {step === "nomatch" && (
              <div
                role="alert"
                className="rounded-[18px] p-5 shadow-[inset_0_0_0_1.5px_var(--chip-no)]"
                style={{ background: "color-mix(in oklab, var(--no) 8%, var(--surface))" }}
              >
                <WarningOctagon size={32} weight="duotone" className="text-chip-no" aria-hidden />
                <p className="mt-2 font-display text-h3 font-semibold text-ink">{t("join.noMatch")}</p>
                <p className="mt-1 text-body-sm text-ink-2">{t("join.nothingSaved")}</p>
              </div>
            )}

            {step === 3 && saved && (
              <div className="flex flex-col items-center pt-6 text-center">
                <Seal size={96} state="confirmed" draw drawDelay={0.2} />
                <h1 className="mt-6 font-display text-h1 font-semibold text-ink">{t("join.saved", { name: saved.label })}</h1>
              </div>
            )}
          </m.section>
        </AnimatePresence>
      </div>

      <BottomActions>
        {step === 1 &&
          (existing ? (
            <Button full onClick={() => navigate("/verify/what", { state: { memberId: existing.id } })}>
              {t("join.verifyNow", { name: existing.label })}
            </Button>
          ) : (
            <Button full onClick={() => go(2)} disabled={existing === undefined || profile === undefined}>
              {t("common.continue")}
            </Button>
          ))}
        {step === 2 && (
          <>
            <Button full loading={busy} onClick={save}>
              {t("family.wordsYes")}
            </Button>
            <Button
              full
              variant="secondary"
              onClick={() => {
                haptic("error");
                go("nomatch");
              }}
            >
              {t("common.no")}
            </Button>
          </>
        )}
        {step === "nomatch" && (
          <Button full variant="secondary" onClick={() => navigate("/", { replace: true })}>
            {t("join.goHome")}
          </Button>
        )}
        {step === 3 && saved && (
          <>
            {saved.canBeVerified && (
              <Button full onClick={() => navigate("/verify/what", { state: { memberId: saved.id } })}>
                {t("join.verifyNow", { name: saved.label })}
              </Button>
            )}
            <Button full variant={saved.canBeVerified ? "ghost" : "primary"} onClick={() => navigate("/home", { replace: true })}>
              {t("join.goHome")}
            </Button>
          </>
        )}
      </BottomActions>
    </PageBody>
  );
}
