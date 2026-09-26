// App-wide providers: Motion (lazy features + reduced motion), display preferences,
// language and sounds. Preferences come from IndexedDB and are applied to <html>.
import { useEffect, type ReactNode } from "react";
import { LazyMotion, MotionConfig } from "motion/react";
import { setHindiForm, switchLanguage } from "./i18n";
import { usePrefs } from "@/store/profile";
import { applyDisplay, readDisplayCache, systemPrefersReducedMotion, watchSystemDisplay } from "./theme";
import { setSoundsEnabled } from "@/design/sounds";
import { useSession } from "./session";

const loadFeatures = () => import("./motionFeatures").then((m) => m.default);

export function Providers({ children }: { children: ReactNode }) {
  const prefs = usePrefs();
  const reduced = useSession((s) => s.reducedMotion);

  useEffect(() => {
    if (!prefs) return;
    applyDisplay({
      theme: prefs.theme,
      textSize: prefs.textSize,
      reduceMotion: prefs.reduceMotion,
      lang: prefs.lang,
    });
    void switchLanguage(prefs.lang);
    setHindiForm(prefs.hindiForm);
    setSoundsEnabled(prefs.soundsOn);
    useSession.setState({ reducedMotion: prefs.reduceMotion || systemPrefersReducedMotion() });
  }, [prefs]);

  useEffect(
    () =>
      watchSystemDisplay(() => {
        const cached = readDisplayCache();
        if (cached) useSession.setState({ reducedMotion: cached.reduceMotion || systemPrefersReducedMotion() });
        return cached;
      }),
    [],
  );

  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion={reduced ? "always" : "never"}>{children}</MotionConfig>
    </LazyMotion>
  );
}
