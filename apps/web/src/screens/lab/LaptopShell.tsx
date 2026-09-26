// Shared frame for the laptop tools (Security Lab, Call Guard): a sticky header with the seal,
// the title, an optional tag, and quick theme / language toggles for this device.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Moon, Sun, Translate } from "@phosphor-icons/react";
import { Seal } from "@/components/Seal";
import { setPrefs, usePrefs } from "@/store/profile";
import { resolveTheme } from "@/app/theme";
import { SIM_OFFSET } from "@/components/SimulationBadge";
import { cn } from "@/lib/cn";

export function LaptopHeader({
  title,
  tag,
  children,
  danger,
}: {
  title: string;
  tag?: string;
  children?: ReactNode;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const theme = prefs ? resolveTheme(prefs.theme) : "dark";
  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b bg-[color-mix(in_oklab,var(--bg)_92%,transparent)] backdrop-blur-md transition-colors duration-500",
        danger ? "border-[#E5463A] shadow-[0_1px_0_#E5463A,0_10px_30px_-20px_#E5463A]" : "border-line",
      )}
      style={{ paddingTop: SIM_OFFSET }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-5 gap-y-3 px-6 py-3.5 lg:px-8">
        <div className="flex items-center gap-3">
          <Seal size={40} />
          <h1 className="font-display text-h2 font-semibold text-ink">{title}</h1>
          {tag && (
            <span className="rounded-full px-2.5 py-1 text-caption font-semibold text-brass-ink shadow-[inset_0_0_0_1.5px_var(--brass)]">
              {tag}
            </span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {children}
          <div className="flex items-center gap-1 rounded-full bg-surface-2 p-1">
            <button
              type="button"
              aria-label={theme === "dark" ? t("display.light") : t("display.dark")}
              onClick={() => void setPrefs({ theme: theme === "dark" ? "light" : "dark" })}
              className="grid h-9 w-9 place-items-center rounded-full text-ink-2 hover:bg-surface"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              aria-label={t("settings.language")}
              onClick={() => void setPrefs({ lang: prefs?.lang === "hi" ? "en" : "hi" })}
              className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-caption font-semibold text-ink-2 hover:bg-surface"
            >
              <Translate size={16} /> {prefs?.lang === "hi" ? "EN" : "हि"}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export function LaptopNarrowNote({ text }: { text: string }) {
  return (
    <p className="mx-auto mt-4 max-w-[1280px] px-6 text-body-sm text-muted md:hidden" role="note">
      {text}
    </p>
  );
}
