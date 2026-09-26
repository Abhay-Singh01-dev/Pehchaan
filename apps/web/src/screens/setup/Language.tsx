// A2 · Choose language (spec B12 A2) — also I1d (Settings → Language) with `mode="settings"`.
// A tap sets the language immediately; the whole UI crossfades to it, then (in setup) continues
// to A3 after 300 ms. The selected card fills from the centre; the other fades to 40%.
import { useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Seal } from "@/components/Seal";
import { SelectCard } from "@/components/controls";
import { PageBody } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { setPrefs, usePrefs } from "@/store/profile";
import { useRecordSetupStep } from "@/app/startRoute";
import { useReduced } from "@/app/session";
import { dur, riseIn } from "@/design/motion";
import type { Lang } from "@/services/types";
import { toast } from "@/app/ui";

export function LanguageCards({
  onPicked,
  picked,
  dimOthers = true,
}: {
  onPicked: (l: Lang) => void;
  picked: Lang | null;
  dimOthers?: boolean;
}) {
  const { t } = useTranslation();
  const reduced = useReduced();
  return (
    <div className="flex flex-col gap-3">
      {(["en", "hi"] as const).map((l, i) => (
        <m.div key={l} {...riseIn(i + 2, reduced)}>
          <SelectCard
            lang={l}
            selected={picked === l}
            dimmed={dimOthers && picked !== null && picked !== l}
            onClick={() => onPicked(l)}
            className="min-h-[88px]"
            icon={<span className="font-display text-h2 font-semibold">{l === "en" ? "Aa" : "अ"}</span>}
            title={t(`lang.${l}`)}
            hint={l === "en" ? t("lang.enSample") : t("lang.hiSample")}
          />
        </m.div>
      ))}
    </div>
  );
}

export function Language() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const [picked, setPicked] = useState<Lang | null>(null);
  useRecordSetupStep();

  const pick = async (l: Lang) => {
    if (picked) return;
    setPicked(l);
    await setPrefs({ lang: l, hindiForm: "n" });
    window.setTimeout(() => navigate("/setup/welcome"), 300 + (reduced ? 0 : 200));
  };

  return (
    <PageBody noTopBar className="flex min-h-app flex-col">
      <div className="mt-6 flex flex-col items-center text-center">
        <m.div layoutId="brand-seal">
          <Seal size={56} />
        </m.div>
        <m.h1 className="mt-6 font-display text-h1 font-semibold text-ink" lang="en" {...riseIn(0, reduced)}>
          Choose your language
        </m.h1>
        <m.p className="mt-1 font-display text-h2 font-semibold text-ink-2" lang="hi" {...riseIn(1, reduced)}>
          अपनी भाषा चुनें
        </m.p>
      </div>
      <div className="mt-10">
        <LanguageCards picked={picked} onPicked={pick} />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <m.p
          key={t("lang.later")}
          className="mt-6 text-center text-body-sm text-muted"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.fast }}
        >
          {t("lang.later")}
        </m.p>
      </AnimatePresence>
    </PageBody>
  );
}

/** I1d · Settings → Language: the same two big cards, switching instantly. */
export function LanguageSettings() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  return (
    <>
      <TopBar title={t("settings.language")} />
      <PageBody>
        <h1 className="mb-6 font-display text-h1 font-semibold text-ink">{t("settings.language")}</h1>
        <LanguageCards
          picked={prefs?.lang ?? null}
          dimOthers={false}
          onPicked={async (l) => {
            await setPrefs({ lang: l });
            toast(l === "en" ? "English" : "हिन्दी", { tone: "success", duration: 1800 });
          }}
        />
      </PageBody>
    </>
  );
}
