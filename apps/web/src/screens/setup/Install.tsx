// A1 · Install Pehchaan (spec B12 A1). Browser only: in standalone mode it never shows.
//   Android/Chrome: "Add to Home Screen" uses the saved beforeinstallprompt event.
//   iPhone/Safari: a 2-step visual guide (Share → Add to Home Screen).
//   In-app browsers (Instagram, WhatsApp…): "Open this link in Chrome or Safari" + copy link.
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { ArrowSquareOut, DeviceMobile, Export, Link as LinkIcon, PlusSquare } from "@phosphor-icons/react";
import { Seal } from "@/components/Seal";
import { Button } from "@/components/Button";
import { PageBody, BottomActions } from "@/components/screen/Page";
import { PhoneHome } from "@/components/illustrations";
import { copyText } from "@/components/PhoneNumber";
import { detectPlatform, isStandalone } from "@/app/pwa";
import { decideStart } from "@/app/startRoute";
import { useSession, useReduced } from "@/app/session";
import { setMeta } from "@/store/meta";
import { toast } from "@/app/ui";
import { riseIn } from "@/design/motion";

export function Install() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const platform = useMemo(detectPlatform, []);
  const installPrompt = useSession((s) => s.installPrompt);

  const proceed = async () => {
    await setMeta("installDismissed", true);
    navigate(await decideStart({ skipInstall: true }), { replace: true });
  };

  useEffect(() => {
    // Already installed / opened from the home screen: go straight on.
    if (isStandalone()) void proceed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    useSession.setState({ installPrompt: null });
    if (choice.outcome === "accepted") {
      toast(t("install.installed"), { tone: "success", duration: 6000 });
      await setMeta("installDismissed", true);
    }
  };

  return (
    <PageBody noTopBar className="flex min-h-app flex-col">
      <div className="flex flex-col items-center text-center">
        <m.div layoutId="brand-seal">
          <Seal size={72} />
        </m.div>
        <m.h1 className="mt-4 font-display text-h1 font-semibold text-ink" {...riseIn(0, reduced)}>
          {t("install.title")}
        </m.h1>
        <m.p className="mt-1 text-body text-ink-2" {...riseIn(1, reduced)}>
          {t("app.tagline")}
        </m.p>
      </div>

      <div className="my-6 flex justify-center">
        <PhoneHome size={150} />
      </div>

      {platform === "inapp" ? (
        <m.div className="card p-5" {...riseIn(2, reduced)}>
          <div className="flex items-start gap-3">
            <ArrowSquareOut size={28} weight="duotone" className="mt-0.5 shrink-0 text-brand" aria-hidden />
            <div>
              <h2 className="font-display text-h3 font-semibold text-ink">{t("install.inAppTitle")}</h2>
              <p className="mt-1 text-body-sm text-ink-2">{t("install.inAppBody")}</p>
            </div>
          </div>
          <Button
            className="mt-4"
            full
            variant="secondary"
            icon={<LinkIcon size={20} />}
            onClick={async () => {
              if (await copyText(window.location.origin)) toast(t("common.linkCopied"), { tone: "success" });
            }}
          >
            {t("install.copyLink")}
          </Button>
        </m.div>
      ) : platform === "ios" ? (
        <m.div className="card p-5" {...riseIn(2, reduced)}>
          <h2 className="font-display text-h3 font-semibold text-ink">{t("install.iosTitle")}</h2>
          <ol className="mt-4 space-y-4">
            <li className="flex items-center gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-brand-soft text-brand-ink">
                <Export size={26} weight="bold" aria-hidden />
              </span>
              <span>
                <span className="block text-body font-semibold text-ink">1. {t("install.iosStep1")}</span>
                <span className="block text-body-sm text-muted">{t("install.iosStep1Hint")}</span>
              </span>
            </li>
            <li className="flex items-center gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-brand-soft text-brand-ink">
                <PlusSquare size={26} weight="bold" aria-hidden />
              </span>
              <span>
                <span className="block text-body font-semibold text-ink">2. {t("install.iosStep2")}</span>
                <span className="block text-body-sm text-muted">{t("install.iosStep2Hint")}</span>
              </span>
            </li>
          </ol>
        </m.div>
      ) : (
        <m.p className="mx-auto max-w-[32ch] text-center text-body text-ink-2" {...riseIn(2, reduced)}>
          {platform === "desktop" && !installPrompt ? t("install.desktopHint") : t("install.lead")}
        </m.p>
      )}

      <div className="flex-1" />
      <BottomActions>
        {installPrompt && platform !== "ios" && platform !== "inapp" && (
          <Button full icon={<DeviceMobile size={22} weight="bold" />} onClick={install}>
            {t("install.add")}
          </Button>
        )}
        <Button full variant={installPrompt ? "ghost" : "primary"} onClick={proceed}>
          {t("install.continue")}
        </Button>
      </BottomActions>
    </PageBody>
  );
}
