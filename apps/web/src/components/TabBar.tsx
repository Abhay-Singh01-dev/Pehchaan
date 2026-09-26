// TabBar (spec B11, B12.0): a floating pill with 4 tabs (icons + labels) and a sliding active
// indicator (shared layoutId, spring.ui). Visible on Home, Family, History and Settings only.
import { useLocation, useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { ClockCounterClockwise, GearSix, House, UsersThree, type Icon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { spring } from "@/design/motion";
import { useReduced } from "@/app/session";
import { cn } from "@/lib/cn";

export const TAB_ROUTES = ["/home", "/family", "/history", "/settings"] as const;

const TABS: Array<{ to: (typeof TAB_ROUTES)[number]; key: string; icon: Icon }> = [
  { to: "/home", key: "tab.home", icon: House },
  { to: "/family", key: "tab.family", icon: UsersThree },
  { to: "/history", key: "tab.history", icon: ClockCounterClockwise },
  { to: "/settings", key: "tab.settings", icon: GearSix },
];

export const isTabRoute = (path: string) => (TAB_ROUTES as readonly string[]).includes(path);

export function TabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const reduced = useReduced();
  const visible = isTabRoute(pathname);

  return (
    <AnimatePresence>
      {visible && (
        <m.nav
          key="tabbar"
          aria-label={t("a11y.mainNav")}
          className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px] px-4"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
          initial={reduced ? { opacity: 0 } : { y: 90, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { y: 0, opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { y: 90, opacity: 0 }}
          transition={spring.soft}
        >
          <div className="grid h-[68px] grid-cols-4 gap-1 rounded-full bg-surface p-1.5 shadow-[0_18px_40px_rgba(15,20,48,0.16),inset_0_0_0_1px_var(--line)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            {TABS.map(({ to, key, icon: TabIcon }) => {
              const active = pathname === to;
              return (
                <button
                  key={to}
                  type="button"
                  onClick={() => !active && navigate(to)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-full outline-offset-[-2px]",
                    active ? "text-brand-ink" : "text-muted",
                  )}
                >
                  {active && (
                    <m.span
                      layoutId="tab-pill"
                      className="absolute inset-0 rounded-full bg-brand-soft"
                      transition={spring.ui}
                    />
                  )}
                  <TabIcon size={24} weight={active ? "fill" : "regular"} className="relative" aria-hidden />
                  <span className="relative text-caption font-medium leading-none">{t(key)}</span>
                </button>
              );
            })}
          </div>
        </m.nav>
      )}
    </AnimatePresence>
  );
}
