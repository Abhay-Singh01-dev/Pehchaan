// I5 · Delete all data (spec B12 I5): explains what is deleted, then a two-step in-page confirm
// ("Delete everything" → "Yes, delete"). Clears IndexedDB, deletes the key, and returns to A2.
import { useState } from "react";
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Key, ClockCounterClockwise, UserCircle, UsersThree, Trash } from "@phosphor-icons/react";
import { services } from "@/services";
import { Button } from "@/components/Button";
import { InlineConfirm } from "@/components/InlineConfirm";
import { BottomActions, PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { deleteAllData } from "@/store/maintenance";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";

export function DeleteAll() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
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
          {!confirm && (
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
              await services.key.deleteKey();
              await deleteAllData();
              navigate("/setup/language", { replace: true });
            }}
          />
        </BottomActions>
      </PageBody>
    </>
  );
}
