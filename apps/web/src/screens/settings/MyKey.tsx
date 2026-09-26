// I1b · My key (spec B12 I1b): status, safety words, "Family can verify me" (turning it off asks
// first), and "Replace my key" (asks first, then an A6-style flow).
import { useState } from "react";
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { ArrowsClockwise, Key, SealCheck } from "@phosphor-icons/react";
import { Button } from "@/components/Button";
import { InlineConfirm } from "@/components/InlineConfirm";
import { SafetyWords } from "@/components/SafetyWords";
import { Switch } from "@/components/controls";
import { PageBody, PageTitle, Section } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { updateProfile, useProfile } from "@/store/profile";
import { useG } from "@/app/i18n";
import { toast } from "@/app/ui";
import { useReduced } from "@/app/session";
import { formatDateShort } from "@/lib/format";
import { riseIn } from "@/design/motion";
import { PageSkeleton } from "@/components/Skeleton";

export function MyKey() {
  const { t, lang } = useG();
  const navigate = useNavigate();
  const profile = useProfile();
  const reduced = useReduced();
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  if (!profile) return <PageSkeleton />;
  const hasKey = Boolean(profile.keyId);
  const verifiable = hasKey && profile.role === "can_be_verified";
  const created = profile.keyCreatedAt ? formatDateShort(profile.keyCreatedAt, lang) : "—";

  return (
    <>
      <TopBar title={t("myKey.title")} />
      <PageBody>
        <PageTitle>{t("myKey.title")}</PageTitle>
        {!hasKey ? (
          <div className="card p-5">
            <p className="text-body text-ink-2">{t("myKey.noKey")}</p>
            <Button className="mt-4" full icon={<Key size={20} />} onClick={() => navigate("/setup/key?from=settings")}>
              {t("myKey.create")}
            </Button>
          </div>
        ) : (
          <>
            <m.div className="card flex items-center gap-3.5 p-4" {...riseIn(1, reduced)}>
              <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-brand-soft text-brand-ink">
                <SealCheck size={28} weight="duotone" aria-hidden />
              </span>
              <p className="text-body font-medium text-ink">
                {profile.keyKind === "pin"
                  ? t("myKey.statusPin", { date: created })
                  : t("myKey.status", { date: created })}
              </p>
            </m.div>

            <m.div {...riseIn(2, reduced)}>
              <Section title={t("family.words")}>
                <SafetyWords words={profile.safetyWords ?? []} flip={false} />
              </Section>
            </m.div>

            <m.div className="card mt-6 p-4" {...riseIn(3, reduced)}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-ink">{t("myKey.toggle")}</p>
                  <p className="text-body-sm text-muted">{t("myKey.toggleHint")}</p>
                </div>
                <Switch
                  checked={verifiable}
                  label={t("myKey.toggle")}
                  onChange={async (on) => {
                    if (!on) return setConfirmOff(true);
                    await updateProfile({ role: "can_be_verified" });
                    toast(t("myKey.onDone"), { tone: "success" });
                  }}
                />
              </div>
            </m.div>
            <InlineConfirm
              className="mt-3"
              open={confirmOff}
              message={t("myKey.offConfirm")}
              confirmLabel={t("myKey.turnOff")}
              cancelLabel={t("common.cancel")}
              danger
              onCancel={() => setConfirmOff(false)}
              onConfirm={async () => {
                await updateProfile({ role: "checks_only" });
                setConfirmOff(false);
                toast(t("myKey.offDone"));
              }}
            />

            <div className="mt-6">
              {!confirmReplace && (
                <Button
                  full
                  variant="secondary"
                  icon={<ArrowsClockwise size={20} />}
                  onClick={() => setConfirmReplace(true)}
                >
                  {t("myKey.replace")}
                </Button>
              )}
              <InlineConfirm
                open={confirmReplace}
                message={t("myKey.replaceConfirm")}
                confirmLabel={t("myKey.replaceCta")}
                cancelLabel={t("common.cancel")}
                onCancel={() => setConfirmReplace(false)}
                onConfirm={() => navigate("/setup/key?from=settings")}
              />
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
