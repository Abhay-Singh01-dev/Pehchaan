// A7 · You're set up (spec B12 A7): a success seal with a check drawn, then the brass ring
// sheens once. Sets setupComplete. "Add family" → C2, "Later" → Home.
// A8 · Allow notifications (ENABLE_EXTRAS only): shown after A7 when the Notification API
// exists. Both buttons continue; "Allow" only records the choice (real push comes later).
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { Seal } from "@/components/Seal";
import { BellIllustration } from "@/components/illustrations";
import { BottomActions, PageBody } from "@/components/screen/Page";
import { updateProfile } from "@/store/profile";
import { deleteMeta } from "@/store/meta";
import { flags } from "@/app/flags";
import { useReduced } from "@/app/session";
import { ease, riseIn } from "@/design/motion";

function SealSheen({ delay }: { delay: number }) {
  const reduced = useReduced();
  if (reduced) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
      <m.span
        className="absolute inset-y-0 -left-1/2 w-1/2"
        style={{ background: "linear-gradient(100deg, transparent, rgba(217,184,116,0.55), transparent)" }}
        initial={{ x: "-60%", opacity: 0 }}
        animate={{ x: "320%", opacity: [0, 1, 0] }}
        transition={{ duration: 0.9, delay, ease: ease.inOut }}
      />
    </span>
  );
}

export function Done() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();

  useEffect(() => {
    void updateProfile({ setupComplete: true });
    void deleteMeta("setupStep");
  }, []);

  const wantsNotifications = flags.ENABLE_EXTRAS && typeof Notification !== "undefined";
  const go = (dest: string) =>
    navigate(wantsNotifications ? `/setup/notifications?next=${encodeURIComponent(dest)}` : dest, { replace: true });

  return (
    <PageBody noTopBar className="flex min-h-app flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="relative">
          <Seal size={120} state="confirmed" draw drawDelay={0.15} />
          <SealSheen delay={0.7} />
        </div>
        <m.h1 className="mt-8 font-display text-display font-semibold text-ink" {...riseIn(2, reduced, 0.2)}>
          {t("done.title")}
        </m.h1>
        <m.p className="mt-3 max-w-[30ch] text-body text-ink-2" {...riseIn(3, reduced, 0.2)}>
          {t("done.body")}
        </m.p>
      </div>
      <BottomActions>
        <Button full onClick={() => go("/family/add")}>
          {t("done.add")}
        </Button>
        <Button full variant="ghost" onClick={() => go("/home")}>
          {t("done.later")}
        </Button>
      </BottomActions>
    </PageBody>
  );
}

export function Notifications() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reduced = useReduced();
  const next = params.get("next") ?? "/home";
  return (
    <PageBody noTopBar className="flex min-h-app flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <BellIllustration size={150} />
        <m.h1 className="mt-8 font-display text-h1 font-semibold text-ink" {...riseIn(1, reduced)}>
          {t("notif.title")}
        </m.h1>
        <m.p className="mt-3 max-w-[30ch] text-body text-ink-2" {...riseIn(2, reduced)}>
          {t("notif.body")}
        </m.p>
      </div>
      <BottomActions>
        <Button
          full
          onClick={async () => {
            try {
              await Notification.requestPermission();
            } catch {
              /* recorded only; push comes later */
            }
            navigate(next, { replace: true });
          }}
        >
          {t("notif.allow")}
        </Button>
        <Button full variant="ghost" onClick={() => navigate(next, { replace: true })}>
          {t("notif.notNow")}
        </Button>
      </BottomActions>
    </PageBody>
  );
}
