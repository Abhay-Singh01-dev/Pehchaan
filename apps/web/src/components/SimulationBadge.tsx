// The top strip, shown on every screen:
//   - SimulationBadge (spec B12.0, backend FC-1): a fixed top-left chip naming whatever is simulated
//     ("Simulated: network, key"). Never show judges a build with this badge.
//   - The Security Lab banner (backend spec 14.1, layer 5): while THIS phone is opted in to the Lab, a persistent
//     brass chip "Security Lab can see and change this phone's messages · Turn off".
import { Flask, Warning } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { flags } from "@/app/flags";
import { useSession } from "@/app/session";
import { toast } from "@/app/ui";
import { services } from "@/services";

/** Only a build that talks to the real relay with the Lab screens can ever be opted in. */
const LAB_POSSIBLE = flags.ENABLE_LAB && !flags.SIM_RELAY;

export function SimulationBadge() {
  const { t } = useTranslation();
  const labOn = useSession((s) => s.relayInfo?.lab?.optedIn === true);
  if (!flags.SIMULATION && !labOn) return null;
  const parts = [
    flags.SIM_RELAY && t("sim.parts.relay"),
    flags.SIM_KEY && t("sim.parts.key"),
    flags.SIM_VERIFIER && t("sim.parts.verifier"),
  ].filter(Boolean);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] mx-auto max-w-[480px]">
      <div className="flex items-center gap-2 px-5" style={{ paddingTop: "calc(env(safe-area-inset-top) + 3px)" }}>
        {flags.SIMULATION && (
          <span className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 text-caption font-medium text-muted shadow-[inset_0_0_0_1px_var(--line)]">
            <Flask size={12} weight="bold" aria-hidden />
            {t("sim.badge", { parts: parts.join(", ") })}
          </span>
        )}
        {labOn && <LabChip />}
      </div>
    </div>
  );
}

function LabChip() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <span
      role="status"
      className="pointer-events-auto ml-auto inline-flex h-[22px] min-w-0 items-center gap-1.5 rounded-full bg-[#B8904A] pl-2 pr-1 text-caption font-semibold text-[#1F1300]"
    >
      <Warning size={12} weight="bold" aria-hidden className="shrink-0" />
      <span className="truncate">{t("labBanner.text")}</span>
      <button
        type="button"
        disabled={busy}
        className="h-[18px] shrink-0 rounded-full bg-[#1F1300] px-2 text-[11px] font-bold text-[#F3EAD8] disabled:opacity-60"
        onClick={async () => {
          setBusy(true);
          try {
            await services.relay.labOptOut();
            toast(t("labBanner.off"), { tone: "success" });
          } catch {
            toast(t("conn.offline"), { tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("labBanner.turnOff")}
      </button>
    </span>
  );
}

/** Screens push their content down by this much while the top strip can show (simulation, or a Lab build). */
export const SIM_OFFSET = flags.SIMULATION || LAB_POSSIBLE ? 26 : 0;
