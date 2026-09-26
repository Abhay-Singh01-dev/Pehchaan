// I8 · Who can reach me (backend spec 6.4, FC-18): the devices the relay lets contact me. Names come from MY
// family list where known (the relay knows no names); anyone else shows as "Device added via your code on
// {date}". Remove blocks that device (contact.revoke), queued so it still goes out after being offline.
import { useCallback, useEffect, useState } from "react";
import * as m from "motion/react-m";
import { ArrowClockwise, DeviceMobile, UserMinus } from "@phosphor-icons/react";
import type { Contact } from "@/services/types";
import { services } from "@/services";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { InlineConfirm } from "@/components/InlineConfirm";
import { PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useDelayed } from "@/components/Skeleton";
import { useFamily } from "@/store/family";
import { queueContactOp } from "@/app/contacts";
import { useG } from "@/app/i18n";
import { toast } from "@/app/ui";
import { useReduced } from "@/app/session";
import { formatDateShort } from "@/lib/format";
import { riseIn } from "@/design/motion";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ok"; contacts: Contact[] };

export function WhoCanReach() {
  const { t, lang } = useG();
  const reduced = useReduced();
  const family = useFamily();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const slow = useDelayed();

  const refresh = useCallback(() => {
    setLoad({ kind: "loading" });
    services.relay.contacts().then(
      (contacts) => setLoad({ kind: "ok", contacts: [...contacts].sort((a, b) => b.since - a.since) }),
      () => setLoad({ kind: "error" }),
    );
  }, []);
  useEffect(refresh, [refresh]);

  const remove = async (deviceId: string) => {
    setConfirming(null);
    await queueContactOp("revoke", deviceId);
    setLoad((l) => (l.kind === "ok" ? { kind: "ok", contacts: l.contacts.filter((c) => c.deviceId !== deviceId) } : l));
    toast(t("reach.removed"), { tone: "success" });
  };

  return (
    <>
      <TopBar title={t("reach.title")} />
      <PageBody>
        <PageTitle sub={t("reach.intro")}>{t("reach.title")}</PageTitle>

        {load.kind === "loading" && (
          <div className="flex flex-col gap-3" aria-busy="true">
            {slow && [0, 1].map((i) => <div key={i} className="skeleton h-16 w-full rounded-[18px]" />)}
          </div>
        )}

        {load.kind === "error" && (
          <div className="card p-5" role="alert">
            <p className="text-body text-ink-2">{t("reach.offline")}</p>
            <Button className="mt-4" variant="secondary" icon={<ArrowClockwise size={20} />} onClick={refresh}>
              {t("common.retry")}
            </Button>
          </div>
        )}

        {load.kind === "ok" && load.contacts.length === 0 && (
          <p className="card p-5 text-body text-ink-2">{t("reach.empty")}</p>
        )}

        {load.kind === "ok" && load.contacts.length > 0 && (
          <ul className="flex flex-col gap-3">
            {load.contacts.map((c, i) => {
              const member = family?.find((f) => f.deviceId === c.deviceId);
              const date = formatDateShort(c.since, lang);
              return (
                <m.li key={c.deviceId} className="card p-4" {...riseIn(i, reduced)}>
                  <div className="flex items-center gap-3.5">
                    {member ? (
                      <Avatar name={member.label} color={member.color} size={44} />
                    ) : (
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
                        <DeviceMobile size={22} aria-hidden />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-ink">
                        {member ? member.label : t("reach.unknown", { date })}
                      </span>
                      {member && <span className="block text-body-sm text-muted">{t("reach.since", { date })}</span>}
                    </span>
                    {confirming !== c.deviceId && (
                      <Button
                        size="md"
                        variant="ghost"
                        icon={<UserMinus size={18} />}
                        onClick={() => setConfirming(c.deviceId)}
                      >
                        {t("common.remove")}
                      </Button>
                    )}
                  </div>
                  <InlineConfirm
                    className="mt-3"
                    open={confirming === c.deviceId}
                    danger
                    message={t("reach.removeConfirm", { name: member?.label ?? t("reach.thisDevice") })}
                    confirmLabel={t("common.remove")}
                    cancelLabel={t("common.cancel")}
                    onCancel={() => setConfirming(null)}
                    onConfirm={() => remove(c.deviceId)}
                  />
                </m.li>
              );
            })}
          </ul>
        )}
      </PageBody>
    </>
  );
}
