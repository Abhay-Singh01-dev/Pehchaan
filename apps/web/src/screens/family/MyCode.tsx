// C3 · My code (spec B12 C3, B6.4 #4). The QR encodes CardService.toLink(myCard): a full
// https://…/join#c=… link, so any phone camera can open it. "Larger" shows the code full screen
// on white for scanning from a distance or a laptop screen.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { ArrowsOut, Copy, SunDim, X } from "@phosphor-icons/react";
import { services } from "@/services";
import { myCard } from "@/services/card";
import { QRCard, QRImage } from "@/components/QRCard";
import { SafetyWords } from "@/components/SafetyWords";
import { Button } from "@/components/Button";
import { Avatar } from "@/components/Avatar";
import { copyText } from "@/components/PhoneNumber";
import { BottomActions, PageBody } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useProfile } from "@/store/profile";
import { toast } from "@/app/ui";
import { useReduced } from "@/app/session";
import { dur, spring } from "@/design/motion";
import { frameRect, portalTarget } from "@/design/origin";

export function MyCode() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  const reduced = useReduced();
  const [large, setLarge] = useState(false);
  const link = useMemo(() => (profile ? services.card.toLink(myCard(profile)) : ""), [profile]);

  if (!profile) return null;
  const qrLabel = t("myCode.qrLabel", { name: profile.name });

  return (
    <>
      <TopBar title={t("myCode.title")} titleAlways />
      <PageBody>
        <QRCard text={link} label={qrLabel} size={232}>
          <div className="mt-4 flex items-center gap-2.5">
            <Avatar name={profile.name} color={profile.color} size={32} />
            <span className="font-display text-h3 font-semibold text-ink">{profile.name}</span>
          </div>
          <p className="mt-1 text-caption text-muted">{t("myCode.scanMe")}</p>
        </QRCard>

        <div className="mt-5">
          <SafetyWords words={profile.safetyWords ?? []} delay={reduced ? 0 : 0.5} />
          <p className="mt-2 text-center text-body-sm text-ink-2">{t("myCode.caption")}</p>
        </div>

        <p className="mt-4 flex items-center justify-center gap-2 text-body-sm text-muted">
          <SunDim size={18} aria-hidden /> {t("myCode.tip")}
        </p>

        <BottomActions>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" icon={<ArrowsOut size={20} />} onClick={() => setLarge(true)}>
              {t("myCode.larger")}
            </Button>
            <Button
              variant="secondary"
              icon={<Copy size={20} />}
              onClick={async () => {
                if (await copyText(link)) toast(t("common.linkCopied"), { tone: "success" });
              }}
            >
              {t("myCode.copy")}
            </Button>
          </div>
          <Button full onClick={() => navigate(-1)}>
            {t("common.done")}
          </Button>
        </BottomActions>
      </PageBody>

      {createPortal(
        <AnimatePresence>
          {large && (
            <m.div
              role="dialog"
              aria-modal="true"
              aria-label={qrLabel}
              className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-white p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? dur.reduced : dur.base }}
              onClick={() => setLarge(false)}
            >
              <m.div
                initial={reduced ? false : { scale: 0.9 }}
                animate={{ scale: 1 }}
                transition={spring.soft}
                className="w-full"
              >
                <QRImage
                  text={link}
                  size={Math.min(frameRect().width * 0.9, frameRect().height * 0.72)}
                  label={qrLabel}
                  sweep={false}
                  className="mx-auto"
                />
              </m.div>
              <div className="mt-6 flex flex-col items-center gap-1 font-mono text-[1.0625rem] font-semibold tracking-[0.08em] text-[#0F1430]">
                {[0, 2].map((i) => (
                  <p key={i} className="whitespace-nowrap">
                    {(profile.safetyWords ?? []).slice(i, i + 2).join(" · ")}
                  </p>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setLarge(false)}
                aria-label={t("common.close")}
                className="absolute right-4 grid h-12 w-12 place-items-center rounded-full bg-[#0F1430] text-white"
                style={{ top: "calc(env(safe-area-inset-top) + 16px)" }}
              >
                <X size={22} weight="bold" />
              </button>
            </m.div>
          )}
        </AnimatePresence>,
        portalTarget(),
      )}
    </>
  );
}
