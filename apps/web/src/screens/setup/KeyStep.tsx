// A6 · Create your key (spec B12 A6, B6.4 #3). Also used from Settings (?from=settings) for
// "Let family verify you" and "Replace my key".
//   success          key slides into the vault ring; the ring locks with a 30° click and a light
//                    haptic; the check draws; the four safety words flip in one by one
//   no screen lock   "Set a screen lock…" → "I've set it, try again" / "Skip for now"
//   no passkeys      FC-24 (backend 10.3): "This phone can't create a key, so family can't verify you yet. You
//                    can still check others." → continue as checks-only (the PIN fallback is P2, not built)
//   cancelled        "Key not created. Tap to try again."
// Error states can be forced from Diagnostics → Simulation panel → "Next key creation".
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { DeviceMobile, Fingerprint, LockKey, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { services } from "@/services";
import { isKeyError } from "@/services/errors";
import type { SafetyWordsT } from "@/services/types";
import { ownSafetyWords } from "@/services/card";
import { ensureIdentity } from "@/services/identity";
import { Button } from "@/components/Button";
import { SafetyWords } from "@/components/SafetyWords";
import { KeyVault } from "@/components/illustrations";
import { BottomActions, PageBody } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { updateProfile, useProfile } from "@/store/profile";
import { useRecordSetupStep } from "@/app/startRoute";
import { useReduced } from "@/app/session";
import { toast } from "@/app/ui";
import { haptic } from "@/design/haptics";
import { dur, ease, riseIn } from "@/design/motion";

type Phase = "intro" | "waiting" | "done" | "noLock" | "noPasskey" | "cancelled";

export function KeyStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromSettings = params.get("from") === "settings";
  const profile = useProfile();
  const reduced = useReduced();
  const [phase, setPhase] = useState<Phase>("intro");
  const [words, setWords] = useState<SafetyWordsT | null>(null);
  useRecordSetupStep();

  const finishKey = async (k: { keyId: string; publicKey: string }) => {
    // The safety words cover the whole card (device keys and passkey, 6.3), exactly as family will derive them.
    const safetyWords = await ownSafetyWords(
      { role: "can_be_verified", keyId: k.keyId, publicKey: k.publicKey },
      await ensureIdentity(),
    );
    await updateProfile({
      role: "can_be_verified",
      keyId: k.keyId,
      publicKey: k.publicKey,
      safetyWords,
      keyCreatedAt: Date.now(),
      keyKind: "passkey",
    });
    setWords(safetyWords);
    setPhase("done");
    window.setTimeout(() => haptic("success"), reduced ? 0 : 260);
  };

  const create = async () => {
    if (!profile) return;
    const support = await services.key.checkSupport();
    if (support.screenLock === "no") return setPhase("noLock");
    if (!support.passkeys) return setPhase("noPasskey");
    setPhase("waiting");
    try {
      const k = await services.key.createKey({ deviceId: profile.deviceId, name: profile.name });
      await finishKey(k);
    } catch (e) {
      haptic("error");
      // A6 has one retry state for every failure (cancelled, timed out, or refused by the phone).
      setPhase(isKeyError(e, "no_passkeys") ? "noPasskey" : isKeyError(e, "no_screen_lock") ? "noLock" : "cancelled");
    }
  };

  const skip = async () => {
    const id = await ensureIdentity();
    await updateProfile({ role: "checks_only", safetyWords: await ownSafetyWords({ role: "checks_only" }, id) });
    toast(t("key.skipNote"), { duration: 5000 });
    navigate(fromSettings ? "/settings" : "/setup/done");
  };

  const next = () => navigate(fromSettings ? "/settings/key" : "/setup/done");

  const vaultPhase = phase === "done" ? "locked" : phase === "waiting" ? "waiting" : "idle";
  const isError = phase === "noLock" || phase === "noPasskey" || phase === "cancelled";

  return (
    <>
      <TopBar title={t("key.title")} hideBack={phase === "waiting" || phase === "done"} />
      <PageBody className="flex min-h-[calc(var(--app-h)-56px)] flex-col">
        <div className="flex justify-center">
          <KeyVault phase={vaultPhase} size={172} />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={phase}
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -6 }}
            transition={{ duration: dur.base, ease: ease.out }}
            className="mt-4"
          >
            {phase === "done" && words ? (
              <div className="text-center">
                <h1 className="font-display text-h1 font-semibold text-ink">{t("key.done")}</h1>
                <p className="mt-6 text-caption font-medium uppercase tracking-[0.06em] text-muted">
                  {t("key.wordsTitle")}
                </p>
                <SafetyWords words={words} size="lg" className="mt-2" delay={reduced ? 0 : 0.55} />
                <p className="mt-3 text-body-sm text-ink-2">{t("key.wordsCaption")}</p>
              </div>
            ) : isError ? (
              <div className="card p-5">
                <div className="flex gap-3">
                  <WarningCircle size={28} weight="duotone" className="mt-0.5 shrink-0 text-chip-amber" aria-hidden />
                  <p className="text-body font-medium text-ink" role="alert">
                    {phase === "noLock"
                      ? t("key.noLock")
                      : phase === "noPasskey"
                        ? t("key.noPasskey")
                        : t("key.cancelled")}
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <h1 className="text-center font-display text-h1 font-semibold text-ink">{t("key.title")}</h1>
                <p className="mt-2 text-center text-body text-ink-2">{t("key.body")}</p>
                {phase === "waiting" ? (
                  <p
                    className="mt-6 flex items-center justify-center gap-2 text-center text-body font-medium text-brand-ink"
                    aria-live="polite"
                  >
                    <Fingerprint size={22} weight="duotone" aria-hidden />
                    {t("key.waiting")}
                  </p>
                ) : (
                  <div className="card mt-6 p-5">
                    <div className="mb-3 text-caption font-medium uppercase tracking-[0.06em] text-muted">
                      {t("key.what")}
                    </div>
                    <ul className="space-y-3.5">
                      {[
                        { icon: DeviceMobile, text: t("key.point1") },
                        { icon: LockKey, text: t("key.point2") },
                        { icon: UsersThree, text: t("key.point3") },
                      ].map(({ icon: Icon, text }, i) => (
                        <m.li key={text} className="flex items-center gap-3" {...riseIn(i + 1, reduced)}>
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-brand-soft text-brand-ink">
                            <Icon size={22} weight="duotone" aria-hidden />
                          </span>
                          <span className="text-body text-ink">{text}</span>
                        </m.li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </m.div>
        </AnimatePresence>

        <div className="flex-1" />
        <BottomActions>
          {phase === "done" && (
            <Button full onClick={next}>
              {t("common.continue")}
            </Button>
          )}
          {(phase === "intro" || phase === "waiting") && (
            <Button full onClick={create} loading={phase === "waiting"} icon={<Fingerprint size={22} weight="bold" />}>
              {t("key.cta")}
            </Button>
          )}
          {phase === "cancelled" && (
            <Button full onClick={create} icon={<Fingerprint size={22} weight="bold" />}>
              {t("common.retry")}
            </Button>
          )}
          {phase === "noLock" && (
            <>
              <Button full onClick={create}>
                {t("key.noLockRetry")}
              </Button>
              <Button full variant="ghost" onClick={skip}>
                {t("key.skip")}
              </Button>
            </>
          )}
          {phase === "noPasskey" && (
            <>
              <Button full onClick={skip}>
                {t("common.continue")}
              </Button>
            </>
          )}
        </BottomActions>
      </PageBody>
    </>
  );
}
