// A7 · You're set up (spec B12 A7): a success seal with a check drawn, then the brass ring
// sheens once. Sets setupComplete. "Add family" → C2, "Later" → Home.
// A8 · Turn on alerts (backend spec 11.2, FC-8): after A7 wherever this phone can receive pushes, unless alerts
// are already on. Explain first, then ask inside the tap. Refused: say what that means; Settings → Alerts keeps a
// way back. iPhone in a Safari tab: alerts need the Home Screen app first (FC-10).
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { Seal } from "@/components/Seal";
import { BellIllustration } from "@/components/illustrations";
import { BottomActions, PageBody } from "@/components/screen/Page";
import { updateProfile, useProfile } from "@/store/profile";
import { deleteMeta } from "@/store/meta";
import { persistStorage } from "@/services/identity";
import { push, type EnableResult } from "@/app/push";
import { useReduced } from "@/app/session";
import { toast } from "@/app/ui";
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
    // FC-11: ask the browser not to clear the keys and family list (5.4). Installed apps usually get it.
    void persistStorage();
    void deleteMeta("setupStep");
  }, []);

  const go = async (dest: string) => {
    const state = await push.state();
    const ask = state === "off" || state === "install_first";
    navigate(ask ? `/setup/notifications?next=${encodeURIComponent(dest)}` : dest, { replace: true });
  };

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
        <Button full onClick={() => void go("/family/add")}>
          {t("done.add")}
        </Button>
        <Button full variant="ghost" onClick={() => void go("/home")}>
          {t("done.later")}
        </Button>
      </BottomActions>
    </PageBody>
  );
}

/** Only this app's own paths may follow A8 (the `next` parameter comes from the address bar). */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";
}

export function Notifications() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reduced = useReduced();
  const profile = useProfile();
  const next = safeNext(params.get("next"));
  const [result, setResult] = useState<EnableResult | null>(null);
  const [busy, setBusy] = useState(false);
  const installFirst = push.support() === "install_first";
  const cont = () => navigate(next, { replace: true });

  const turnOn = async () => {
    setBusy(true);
    // enable() asks for permission as its very first step, still inside this tap (iPhone requires it).
    const r = await push.enable();
    setBusy(false);
    if (r === "granted") {
      toast(t("notif.on"), { tone: "success" });
      return cont();
    }
    setResult(r);
  };

  const message = installFirst
    ? t("notif.iosInstallFirst")
    : result === "denied"
      ? t("notif.denied")
      : result === "failed"
        ? t("notif.failed")
        : result === "unsupported"
          ? t("notif.unsupported")
          : null;

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
        {profile && profile.role !== "can_be_verified" && (
          <m.p className="mt-2 max-w-[30ch] text-body-sm text-muted" {...riseIn(3, reduced)}>
            {t("notif.askersNote")}
          </m.p>
        )}
        {message && (
          <p role="status" className="card mt-6 max-w-[34ch] p-4 text-body-sm text-ink-2">
            {message}
          </p>
        )}
      </div>
      <BottomActions>
        {!installFirst && result !== "denied" && result !== "unsupported" && (
          <Button full loading={busy} onClick={turnOn}>
            {result === "failed" ? t("common.retry") : t("notif.allow")}
          </Button>
        )}
        <Button full variant={message ? "primary" : "ghost"} onClick={cont}>
          {message ? t("notif.continue") : t("notif.notNow")}
        </Button>
      </BottomActions>
    </PageBody>
  );
}
