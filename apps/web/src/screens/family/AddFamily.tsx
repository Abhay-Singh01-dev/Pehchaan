// C2 · Add family member (spec B12 C2): two big tiles (Show my code / Scan their code) and the
// in-person panel. Checks-only people still get "Show my code" (so family can alert them).
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Camera, HandHeart, QrCode } from "@phosphor-icons/react";
import { PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useProfile } from "@/store/profile";
import { flags } from "@/app/flags";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";
import { Button } from "@/components/Button";

function Tile({
  icon,
  title,
  hint,
  note,
  onClick,
  index,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  note?: string;
  onClick: () => void;
  index: number;
}) {
  const reduced = useReduced();
  return (
    <m.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      {...riseIn(index, reduced)}
      className="card relative flex min-h-[176px] flex-col items-start gap-3 overflow-hidden rounded-[24px] p-5 text-left active:bg-surface-2"
    >
      <span className="grid h-16 w-16 place-items-center rounded-[20px] bg-brand-soft text-brand-ink">{icon}</span>
      <span>
        <span className="block font-display text-h3 font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-body-sm text-ink-2">{hint}</span>
        {note && <span className="mt-1 block text-caption text-muted">{note}</span>}
      </span>
    </m.button>
  );
}

export function AddFamily() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  const reduced = useReduced();
  const checksOnly = profile?.role !== "can_be_verified" || !profile?.keyId;

  return (
    <>
      <TopBar title={t("family.addTitle")} />
      <PageBody>
        <PageTitle>{t("family.addTitle")}</PageTitle>
        <div className="grid grid-cols-2 gap-3">
          <Tile
            index={1}
            icon={<QrCode size={34} weight="duotone" />}
            title={t("family.show")}
            hint={t("family.showHint")}
            note={checksOnly ? t("family.showChecksOnlyNote") : undefined}
            onClick={() => navigate("/family/my-code")}
          />
          <Tile
            index={2}
            icon={<Camera size={34} weight="duotone" />}
            title={t("family.scan")}
            hint={t("family.scanHint")}
            onClick={() => navigate("/family/scan")}
          />
        </div>
        <m.div className="mt-4 flex items-start gap-3 rounded-[18px] bg-brand-soft p-4" {...riseIn(3, reduced)}>
          <HandHeart size={26} weight="duotone" className="mt-0.5 shrink-0 text-brand-ink" aria-hidden />
          <p className="text-body text-ink">{t("family.inperson")}</p>
        </m.div>
        {flags.ENABLE_EXTRAS && (
          <Button className="mt-4" full variant="ghost" onClick={() => navigate("/family/far-away")}>
            {t("family.farAway")}
          </Button>
        )}
      </PageBody>
    </>
  );
}
