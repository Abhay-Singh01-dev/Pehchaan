// The "new phone" scam guard's hard stops (backend spec 6.5), shared by C4 (scan), C5 (confirm) and C8 (link):
//   - impostor: a DIFFERENT device with the same name or phone as someone saved. Full-screen red; the only
//     buttons are "Don't add" and "Call {label} on their saved number".
//   - altered: the SAME device ID with different keys. "This card has been altered. Don't add it."
// Neither can ever be added from here; a real new phone is added by removing the old entry first, face to face.
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { ShieldWarning } from "@phosphor-icons/react";
import type { CardGuard } from "@/services/types";
import { Button } from "./Button";
import { PhoneNumber } from "./PhoneNumber";
import { SIM_OFFSET } from "./SimulationBadge";
import { useReduced } from "@/app/session";
import { spring } from "@/design/motion";

export type CardBlock = Extract<CardGuard, { kind: "altered" | "impostor" }>;

export const isBlocked = (g: CardGuard): g is CardBlock => g.kind === "altered" || g.kind === "impostor";

export function CardWarning({ block, onDontAdd }: { block: CardBlock; onDontAdd: () => void }) {
  const { t } = useTranslation();
  const reduced = useReduced();
  const label = block.member.label;
  const impostor = block.kind === "impostor";
  return (
    <m.div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="card-warning-title"
      className="v-no fixed inset-0 z-[70] flex flex-col overflow-y-auto text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0 } : { duration: 0.2 }}
    >
      <div
        className="mx-auto flex w-full max-w-[480px] flex-1 flex-col px-6"
        style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET + 48}px)` }}
      >
        <m.span
          className="grid h-20 w-20 place-items-center rounded-full bg-white/15"
          initial={{ scale: reduced ? 1 : 0.6 }}
          animate={{ scale: 1 }}
          transition={spring.stamp}
        >
          <ShieldWarning size={44} weight="fill" aria-hidden />
        </m.span>
        <h1 id="card-warning-title" className="mt-6 font-display text-h1 font-semibold">
          {impostor ? t("cardGuard.impostorTitle", { label }) : t("cardGuard.alteredTitle")}
        </h1>
        <p className="mt-3 text-body font-medium text-white/90">
          {impostor ? t("cardGuard.impostorBody", { label }) : t("cardGuard.alteredBody", { label })}
        </p>
        {impostor && <p className="mt-3 text-body-sm text-white/80">{t("cardGuard.impostorHow", { label })}</p>}
        <div className="flex-1" />
        <div className="flex flex-col gap-2.5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
          <Button full variant="on-verdict" onClick={onDontAdd}>
            {t("cardGuard.dontAdd")}
          </Button>
          {impostor && block.member.phone && (
            <PhoneNumber number={block.member.phone} label={t("cardGuard.callSaved", { label })} tone="light" />
          )}
        </div>
      </div>
    </m.div>
  );
}
