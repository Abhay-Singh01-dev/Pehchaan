// I1 · Settings (spec B12 I1): a grouped list with icons and chevrons. Tapping the version five
// times shows "Diagnostics unlocked" and adds a Diagnostics row.
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import {
  Bank,
  Waveform,
  BellSimple,
  Books,
  CaretDown,
  Database,
  Key,
  Palette,
  PhoneCall,
  ShieldWarning,
  Stethoscope,
  Translate,
  Trash,
  Info,
} from "@phosphor-icons/react";
import { Avatar } from "@/components/Avatar";
import { ListGroup, ListRow } from "@/components/List";
import { PageBody } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useProfile } from "@/store/profile";
import { setMeta, useMeta } from "@/store/meta";
import { APP_VERSION, flags } from "@/app/flags";
import { toast } from "@/app/ui";
import { useReduced } from "@/app/session";
import { dur, riseIn, spring } from "@/design/motion";
import { haptic } from "@/design/haptics";
import { PageSkeleton } from "@/components/Skeleton";

export function Settings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  const reduced = useReduced();
  const diagnostics = useMeta<boolean>("diagnosticsUnlocked");
  const [storedOpen, setStoredOpen] = useState(false);
  const taps = useRef<{ n: number; at: number }>({ n: 0, at: 0 });

  const tapVersion = () => {
    if (diagnostics) return navigate("/diagnostics");
    const now = Date.now();
    taps.current = now - taps.current.at < 1500 ? { n: taps.current.n + 1, at: now } : { n: 1, at: now };
    haptic("chip");
    if (taps.current.n >= 5) {
      void setMeta("diagnosticsUnlocked", true);
      toast(t("settings.diagUnlocked"), { tone: "success" });
      taps.current = { n: 0, at: 0 };
    } else if (taps.current.n >= 3) {
      toast(t("settings.tapsLeft", { count: 5 - taps.current.n }), { duration: 900 });
    }
  };

  if (!profile) return <PageSkeleton />;
  const hasKey = profile.role === "can_be_verified" && Boolean(profile.keyId);

  return (
    <>
      <TopBar hideBack title={t("settings.title")} />
      <PageBody withTabBar>
        <m.h1 className="mb-5 font-display text-h1 font-semibold text-ink" {...riseIn(0, reduced)}>
          {t("settings.title")}
        </m.h1>

        {/* 1 · Profile card */}
        <m.button
          type="button"
          onClick={() => navigate("/settings/profile")}
          whileTap={{ scale: 0.985 }}
          {...riseIn(1, reduced)}
          className="card relative flex w-full items-center gap-4 overflow-hidden p-4 text-left active:bg-surface-2"
        >
          <span aria-hidden className="hairline-brass absolute inset-x-6 top-0" />
          <Avatar name={profile.name} color={profile.color} size={56} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-h2 font-semibold text-ink">{profile.name}</span>
            <span className="block text-body-sm text-muted">{t(`settings.role.${hasKey ? "can_be_verified" : "checks_only"}`)}</span>
          </span>
        </m.button>

        <div className="mt-6 flex flex-col gap-6">
          <m.div {...riseIn(2, reduced)}>
            <ListGroup>
              {hasKey ? (
                <ListRow icon={<Key size={22} />} label={t("settings.myKey")} chevron onClick={() => navigate("/settings/key")} />
              ) : (
                <ListRow icon={<Key size={22} />} label={t("settings.letVerify")} chevron onClick={() => navigate("/setup/key?from=settings")} />
              )}
              <ListRow
                icon={<Palette size={22} />}
                label={t("settings.display")}
                value={t(`display.${profile.theme}`)}
                chevron
                onClick={() => navigate("/settings/display")}
              />
              <ListRow
                icon={<Translate size={22} />}
                label={t("settings.language")}
                value={profile.lang === "hi" ? "हिन्दी" : "English"}
                chevron
                onClick={() => navigate("/settings/language")}
              />
              <ListRow icon={<BellSimple size={22} />} label={t("settings.notifications")} />
            </ListGroup>
          </m.div>

          <m.div {...riseIn(3, reduced)}>
            <ListGroup title={t("settings.help")}>
              <ListRow icon={<Books size={22} />} label={t("settings.howItWorks")} chevron onClick={() => navigate("/help/how-it-works")} />
              <ListRow icon={<ShieldWarning size={22} />} label={t("settings.limits")} chevron onClick={() => navigate("/help/limits")} />
              <ListRow icon={<PhoneCall size={22} />} label={t("settings.suspicious")} chevron onClick={() => navigate("/help/suspicious-call")} />
              {flags.ENABLE_EXTRAS && (
                <>
                  <ListRow icon={<Waveform size={22} />} label={t("practice.title")} chevron onClick={() => navigate("/help/practice")} />
                  <ListRow icon={<Bank size={22} />} label={t("payment.title")} chevron onClick={() => navigate("/verify/payment")} />
                </>
              )}
            </ListGroup>
          </m.div>

          <m.div {...riseIn(4, reduced)}>
            <ListGroup title={t("settings.privacy")}>
              <ListRow
                icon={<Database size={22} />}
                label={t("settings.stored")}
                right={
                  <m.span animate={{ rotate: storedOpen ? 180 : 0 }} transition={spring.ui} className="text-muted">
                    <CaretDown size={18} aria-hidden />
                  </m.span>
                }
                onClick={() => setStoredOpen((v) => !v)}
              />
              <AnimatePresence initial={false}>
                {storedOpen && (
                  <m.p
                    className="px-4 pb-4 pt-1 text-body-sm text-ink-2"
                    initial={{ opacity: 0, y: reduced ? 0 : -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: dur.base }}
                  >
                    {t("settings.storedBody")}
                  </m.p>
                )}
              </AnimatePresence>
              <ListRow icon={<Trash size={22} />} label={t("settings.delete")} danger chevron onClick={() => navigate("/settings/delete")} />
            </ListGroup>
          </m.div>

          <m.div {...riseIn(5, reduced)}>
            <ListGroup title={t("settings.about")}>
              <ListRow icon={<Info size={22} />} label={t("settings.version", { v: APP_VERSION })} onClick={tapVersion} />
              {diagnostics && (
                <ListRow icon={<Stethoscope size={22} />} label={t("settings.diagnostics")} chevron onClick={() => navigate("/diagnostics")} />
              )}
            </ListGroup>
          </m.div>
        </div>
      </PageBody>
    </>
  );
}
