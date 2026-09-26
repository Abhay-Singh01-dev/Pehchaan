// D2 · What are they asking for? (spec B12 D2). Builds the VerifyRequest (new requestId,
// 32-byte nonce, 60 s expiry) through the service layer, sends it, and opens D3. The request
// text shown on the other phone matches exactly what's chosen here.
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Bank, CurrencyInr, DeviceMobileCamera, HourglassSimple, Password } from "@phosphor-icons/react";
import type { AskReason } from "@/services/types";
import { Avatar } from "@/components/Avatar";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/Button";
import { ChipGroup } from "@/components/controls";
import { BottomActions, PageBody } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useMember } from "@/store/family";
import { startCheck } from "@/app/verification";
import { useReduced } from "@/app/session";
import { dur, riseIn } from "@/design/motion";
import { PageSkeleton } from "@/components/Skeleton";

export function What() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const reduced = useReduced();
  const state = location.state as { memberId?: string; amountInr?: number } | null;
  const member = useMember(state?.memberId);
  const [reason, setReason] = useState<AskReason>("money");
  const [amount, setAmount] = useState<number | null>(state?.amountInr ?? null);
  const [busy, setBusy] = useState(false);

  if (!state?.memberId || member === null) return <Navigate to="/verify/who" replace />;
  if (!member) return <PageSkeleton />;

  const ask = async (withReason: boolean) => {
    setBusy(true);
    const id = await startCheck({
      member,
      reason: withReason ? reason : undefined,
      amountInr: withReason && reason === "money" && amount ? amount : undefined,
    });
    navigate(`/verify/waiting/${id}`, { replace: true });
  };

  return (
    <>
      <TopBar title={t("verify.what")} />
      <PageBody>
        <m.div className="mb-5 flex items-center gap-3" {...riseIn(0, reduced)}>
          <Avatar name={member.label} color={member.color} size={48} layoutId={`avatar-${member.id}`} />
          <span className="font-display text-h2 font-semibold text-ink">{member.label}</span>
        </m.div>
        <m.h1 className="mb-5 font-display text-h1 font-semibold text-ink" {...riseIn(1, reduced)}>
          {t("verify.what")}
        </m.h1>

        <ChipGroup
          label={t("verify.what")}
          value={reason}
          onChange={setReason}
          options={[
            { value: "money", label: t("reason.money"), icon: <CurrencyInr size={20} aria-hidden /> },
            { value: "otp", label: t("reason.otp"), icon: <Password size={20} aria-hidden /> },
            { value: "bank_details", label: t("reason.bank"), icon: <Bank size={20} aria-hidden /> },
            { value: "install_app", label: t("reason.app"), icon: <DeviceMobileCamera size={20} aria-hidden /> },
            { value: "nothing_yet", label: t("reason.none"), icon: <HourglassSimple size={20} aria-hidden /> },
          ]}
        />

        <AnimatePresence initial={false}>
          {reason === "money" && (
            <m.div
              key="amount"
              className="mt-6"
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : 8 }}
              transition={{ duration: dur.base }}
            >
              <div className="mb-2 text-body-sm font-medium text-ink-2">{t("verify.amount")}</div>
              <AmountInput value={amount} onChange={setAmount} />
            </m.div>
          )}
        </AnimatePresence>

        <BottomActions>
          <Button full loading={busy} onClick={() => ask(true)}>
            {t("verify.ask", { name: member.label })}
          </Button>
          <Button full variant="ghost" disabled={busy} onClick={() => ask(false)}>
            {t("verify.skip")}
          </Button>
        </BottomActions>
      </PageBody>
    </>
  );
}
