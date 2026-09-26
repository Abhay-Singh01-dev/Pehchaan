// I5 · Delete all data (spec B12 I5): explains what is deleted, then a two-step in-page confirm
// ("Delete everything" → "Yes, delete"). Clears IndexedDB, deletes the key, and returns to A2.
// Backend spec 6.6, 17.2 (FC-18): first the relay retires this device (it deletes what it holds within 24 h and
// the ID can never log in again). If the relay can't be reached, the person is told what that means and may
// still delete this phone's data. Then the app restarts with a brand-new device identity.
import { useState } from "react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Key, ClockCounterClockwise, UserCircle, UsersThree, Trash } from "@phosphor-icons/react";
import { services } from "@/services";
import { Button } from "@/components/Button";
import { InlineConfirm } from "@/components/InlineConfirm";
import { BottomActions, PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { deleteAllData } from "@/store/maintenance";
import { resetIdentityCache } from "@/services/identity";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";

export function DeleteAll() {
  const { t } = useTranslation();
  const reduced = useReduced();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unreached, setUnreached] = useState(false);

  const wipeThisPhone = async () => {
    await services.key.deleteKey().catch(() => undefined);
    await deleteAllData();
    resetIdentityCache();
    // A full restart: boot creates a new identity, and nothing from the old one stays in memory.
    window.location.replace("/setup/language");
  };
  const items = [
    { icon: UserCircle, text: t("deleteAll.item1") },
    { icon: UsersThree, text: t("deleteAll.item2") },
    { icon: ClockCounterClockwise, text: t("deleteAll.item3") },
    { icon: Key, text: t("deleteAll.item4") },
  ];

  return (
    <>
      <TopBar title={t("deleteAll.title")} />
      <PageBody>
        <PageTitle sub={t("deleteAll.body")}>{t("deleteAll.title")}</PageTitle>
        <ul className="card divide-y divide-line">
          {items.map(({ icon: Icon, text }, i) => (
            <m.li key={text} className="flex items-center gap-3 px-4 py-3.5" {...riseIn(i + 1, reduced)}>
              <Icon size={22} className="text-chip-no" aria-hidden />
              <span className="text-body text-ink">{text}</span>
            </m.li>
          ))}
        </ul>
        <p className="mt-4 text-body-sm text-muted">{t("deleteAll.note")}</p>
        <BottomActions>
          {!confirm && !unreached && (
            <Button full variant="danger-outline" icon={<Trash size={20} />} onClick={() => setConfirm(true)}>
              {t("deleteAll.cta")}
            </Button>
          )}
          <InlineConfirm
            open={confirm}
            danger
            busy={busy}
            message={t("deleteAll.cta")}
            detail={t("deleteAll.confirmBody")}
            confirmLabel={t("deleteAll.confirm")}
            cancelLabel={t("common.cancel")}
            onCancel={() => setConfirm(false)}
            onConfirm={async () => {
              setBusy(true);
              try {
                await services.relay.retire();
              } catch {
                setBusy(false);
                setConfirm(false);
                setUnreached(true);
                return;
              }
              await wipeThisPhone();
            }}
          />
          <InlineConfirm
            open={unreached}
            danger
            busy={busy}
            message={t("deleteAll.unreached")}
            detail={t("deleteAll.unreachedBody")}
            confirmLabel={t("deleteAll.phoneOnly")}
            cancelLabel={t("common.cancel")}
            onCancel={() => setUnreached(false)}
            onConfirm={async () => {
              setBusy(true);
              await wipeThisPhone();
            }}
          />
        </BottomActions>
      </PageBody>
    </>
  );
}
