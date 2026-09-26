// I1c · Display (spec B12 I1c): Theme (System / Light / Dark) with a live mini preview; Text size
// (Normal / Large / Extra large) with a live preview of a verdict card; Reduce motion; Sounds.
// Previews set data-theme / data-text-size on their own box, so the real tokens render there.
import { useTranslation } from "react-i18next";
import * as m from "motion/react-m";
import type { TextSize, ThemePref } from "@/services/types";
import { Seal } from "@/components/Seal";
import { Segmented, Switch } from "@/components/controls";
import { PageBody, PageTitle, Section } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { setPrefs, usePrefs } from "@/store/profile";
import { resolveTheme } from "@/app/theme";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";
import { PageSkeleton } from "@/components/Skeleton";

function ThemePreview({ theme }: { theme: ThemePref }) {
  const resolved = resolveTheme(theme);
  return (
    <div
      data-theme={resolved}
      className="frame-bg overflow-hidden rounded-[18px] p-3 shadow-[inset_0_0_0_1px_var(--line)]"
    >
      <div className="flex items-center gap-2">
        <span className="h-6 w-6 rounded-full" style={{ background: "var(--av-rose)" }} />
        <span className="h-2.5 w-24 rounded-full bg-ink/80" />
      </div>
      <div
        className="mt-3 flex h-14 items-center gap-3 rounded-[16px] px-3"
        style={{ background: "linear-gradient(150deg, var(--brand), var(--brand-strong))" }}
      >
        <span className="h-7 w-7 rounded-full bg-[color-mix(in_oklab,var(--on-brand)_20%,transparent)]" />
        <span className="h-2.5 w-28 rounded-full bg-[color-mix(in_oklab,var(--on-brand)_85%,transparent)]" />
      </div>
      <div className="card mt-3 flex items-center gap-2 p-2.5">
        <Seal size={24} />
        <span className="h-2 w-32 rounded-full bg-ink-2/50" />
      </div>
    </div>
  );
}

function TextSizePreview({ size }: { size: TextSize }) {
  const { t } = useTranslation();
  return (
    <div data-text-size={size} className="v-ok flex items-center gap-4 overflow-hidden rounded-[20px] p-4">
      <Seal size={56} state="confirmed" tone="light" />
      <div className="min-w-0">
        <p className="font-display text-h1 font-semibold leading-tight">{t("v.ok.title")}</p>
        <p className="text-body">{t("v.ok.body", { name: t("howItWorks.examplePerson") })}</p>
      </div>
    </div>
  );
}

export function Display() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const reduced = useReduced();
  if (!prefs) return <PageSkeleton />;

  return (
    <>
      <TopBar title={t("display.title")} />
      <PageBody>
        <PageTitle>{t("display.title")}</PageTitle>

        <m.div {...riseIn(1, reduced)}>
          <Section title={t("display.theme")} className="mt-0">
            <Segmented
              id="theme"
              label={t("display.theme")}
              value={prefs.theme}
              onChange={(theme) => void setPrefs({ theme })}
              options={[
                { value: "system", label: t("display.system") },
                { value: "light", label: t("display.light") },
                { value: "dark", label: t("display.dark") },
              ]}
            />
            <div className="mt-3">
              <ThemePreview theme={prefs.theme} />
            </div>
          </Section>
        </m.div>

        <m.div {...riseIn(2, reduced)}>
          <Section title={t("display.textSize")}>
            <Segmented
              id="text"
              label={t("display.textSize")}
              value={prefs.textSize}
              onChange={(textSize) => void setPrefs({ textSize })}
              options={[
                { value: "normal", label: t("display.normal") },
                { value: "large", label: t("display.large") },
                { value: "xlarge", label: t("display.xlarge") },
              ]}
            />
            <div className="mt-3">
              <TextSizePreview size={prefs.textSize} />
            </div>
          </Section>
        </m.div>

        <m.div className="card mt-8 divide-y divide-line" {...riseIn(3, reduced)}>
          <div className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink">{t("display.reduceMotion")}</p>
              <p className="text-body-sm text-muted">{t("display.reduceMotionHint")}</p>
            </div>
            <Switch
              checked={prefs.reduceMotion}
              label={t("display.reduceMotion")}
              onChange={(v) => void setPrefs({ reduceMotion: v })}
            />
          </div>
          <div className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink">{t("display.sounds")}</p>
              <p className="text-body-sm text-muted">{t("display.soundsHint")}</p>
            </div>
            <Switch
              checked={prefs.soundsOn}
              label={t("display.sounds")}
              onChange={(v) => void setPrefs({ soundsOn: v })}
            />
          </div>
        </m.div>
      </PageBody>
    </>
  );
}
