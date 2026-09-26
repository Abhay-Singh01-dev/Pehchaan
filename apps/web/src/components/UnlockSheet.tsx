// F2 · Unlock to confirm — simulation build (spec B12 F2).
// An in-app sheet that looks like a system biometric prompt: a fingerprint glyph, "Confirm
// it's you", "Touch the sensor"; a large fingerprint button (tap = success), "Use PIN" (any
// 4 digits) and "Cancel"; captioned "Simulated unlock". On success the glyph fills with the
// brand colour from the bottom (400 ms). In the real build the phone's own sheet appears.
import { useEffect, useState } from "react";
import * as m from "motion/react-m";
import { Backspace, Fingerprint } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Sheet } from "./Sheet";
import { useUnlockBridge } from "@/services/sim/unlockBridge";
import { KeyError } from "@/services/errors";
import { flags } from "@/app/flags";
import { haptic } from "@/design/haptics";
import { ease, spring } from "@/design/motion";
import { useReduced } from "@/app/session";
import { cn } from "@/lib/cn";

export function UnlockSheet() {
  const pending = useUnlockBridge((s) => s.pending);
  if (!flags.SIMULATION) return null;
  return <UnlockSheetInner key={pending?.id ?? "none"} />;
}

function UnlockSheetInner() {
  const pending = useUnlockBridge((s) => s.pending);
  const { t } = useTranslation();
  const reduced = useReduced();
  const [mode, setMode] = useState<"finger" | "pin">("finger");
  const [pin, setPin] = useState("");
  const [success, setSuccess] = useState(false);

  const succeed = () => {
    if (success || !pending) return;
    setSuccess(true);
    haptic("lock");
    window.setTimeout(() => pending.resolve(), reduced ? 150 : 520);
  };

  const cancel = () => {
    if (success) return;
    pending?.reject(new KeyError("cancelled"));
  };

  useEffect(() => {
    if (pin.length === 4) succeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const decisionLabel = pending ? (pending.decision === "ME" ? t("ask.yes") : t("ask.no")) : "";

  return (
    <Sheet open={Boolean(pending)} onClose={cancel} tone="ink" label={t("unlock.title")}>
      <div className="flex flex-col items-center pb-1 pt-2 text-center">
        <p className="font-display text-h2 font-semibold text-white">{t("unlock.title")}</p>
        <p className="mt-1 text-body-sm text-[#C3C8E8]">{t("unlock.answering", { decision: decisionLabel })}</p>

        {mode === "finger" ? (
          <>
            <p className="mt-5 text-body text-[#C3C8E8]">{success ? t("unlock.confirmed") : t("unlock.touch")}</p>
            <m.button
              type="button"
              onClick={succeed}
              aria-label={t("unlock.fingerprint")}
              whileTap={{ scale: 0.94 }}
              transition={spring.ui}
              className="relative mt-4 grid h-[104px] w-[104px] place-items-center rounded-full bg-white/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
            >
              {!success && !reduced && (
                <m.span
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{ boxShadow: "0 0 0 2px rgba(140,149,255,0.5)" }}
                  animate={{ scale: [1, 1.18], opacity: [0.8, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                />
              )}
              <span className="relative">
                <Fingerprint size={64} weight="light" className="text-[#8D94BC]" />
                <m.span
                  aria-hidden
                  className="absolute inset-0 text-[#8C95FF]"
                  initial={{ clipPath: "inset(100% 0 0 0)" }}
                  animate={{ clipPath: success ? "inset(0% 0 0 0)" : "inset(100% 0 0 0)" }}
                  transition={{ duration: reduced ? 0.12 : 0.4, ease: ease.out }}
                >
                  <Fingerprint size={64} weight="bold" />
                </m.span>
              </span>
            </m.button>
          </>
        ) : (
          <PinPad pin={pin} setPin={setPin} disabled={success} />
        )}

        <div className="mt-6 grid w-full grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={cancel}
            className="h-12 rounded-full text-body font-semibold text-[#C3C8E8] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] active:bg-white/5"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              setPin("");
              setMode(mode === "finger" ? "pin" : "finger");
            }}
            disabled={success}
            className="h-12 rounded-full bg-white/10 text-body font-semibold text-white active:bg-white/15"
          >
            {mode === "finger" ? t("unlock.usePin") : t("unlock.useFingerprint")}
          </button>
        </div>
        <p className="mt-4 text-caption text-[#8D94BC]">{t("unlock.sim")}</p>
      </div>
    </Sheet>
  );
}

function PinPad({ pin, setPin, disabled }: { pin: string; setPin: (p: string) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <div className="mt-4 w-full">
      <p className="text-body text-[#C3C8E8]">{t("unlock.pinTitle")}</p>
      <div className="mt-3 flex justify-center gap-3" aria-live="polite" aria-label={`${pin.length} / 4`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-3.5 w-3.5 rounded-full transition-colors duration-150",
              i < pin.length ? "bg-[#8C95FF]" : "bg-white/15",
            )}
          />
        ))}
      </div>
      <div className="mx-auto mt-4 grid max-w-[280px] grid-cols-3 gap-2">
        {keys.map((k, i) =>
          k === "" ? (
            <span key={i} />
          ) : (
            <m.button
              key={k}
              type="button"
              disabled={disabled}
              whileTap={{ scale: 0.9 }}
              transition={spring.ui}
              onClick={() => {
                haptic("chip");
                if (k === "del") setPin(pin.slice(0, -1));
                else if (pin.length < 4) setPin(pin + k);
              }}
              aria-label={k === "del" ? t("unlock.delete") : k}
              className="grid h-14 place-items-center rounded-full bg-white/[0.06] font-mono text-h2 font-medium text-white active:bg-white/15"
            >
              {k === "del" ? <Backspace size={24} /> : k}
            </m.button>
          ),
        )}
      </div>
    </div>
  );
}
