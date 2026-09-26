// Diagnostics → "Allow Security Lab on this phone" (backend spec 14.1, layer 3; FC-20). Asks for the Lab
// password; the opt-in lasts 4 h on the relay. While on, the app shows the brass banner everywhere and the Lab can
// see and change this phone's messages to other opted-in test phones (never anyone else's).
import { useState } from "react";
import { Flask } from "@phosphor-icons/react";
import { services } from "@/services";
import { isRelayError } from "@/services/errors";
import { Button } from "@/components/Button";
import { TextField } from "@/components/controls";
import { useSession } from "@/app/session";
import { useG } from "@/app/i18n";
import { toast } from "@/app/ui";

export function LabOptIn() {
  const { t } = useG();
  const optedIn = useSession((s) => s.relayInfo?.lab?.optedIn === true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await services.relay.labOptIn(password);
      setPassword("");
      toast(t("diag.lab.on"), { tone: "success" });
    } catch (e) {
      const reason = isRelayError(e) ? e.reason : undefined;
      setError(
        reason === "lab_denied"
          ? t("diag.lab.wrongPassword")
          : reason === "lab_disabled"
            ? t("diag.lab.disabled")
            : reason === "rate_limited"
              ? t("diag.lab.tooMany")
              : t("conn.offline"),
      );
    } finally {
      setBusy(false);
    }
  };

  const optOut = async () => {
    setBusy(true);
    try {
      await services.relay.labOptOut();
      toast(t("labBanner.off"), { tone: "success" });
    } catch {
      toast(t("conn.offline"), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      <p className="flex items-start gap-2.5 text-body-sm text-ink-2">
        <Flask size={20} weight="duotone" className="mt-0.5 shrink-0 text-brand" aria-hidden />
        {optedIn ? t("diag.lab.onBody") : t("diag.lab.body")}
      </p>
      {optedIn ? (
        <Button className="mt-4" full variant="secondary" loading={busy} onClick={optOut}>
          {t("labBanner.turnOff")}
        </Button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <TextField
            label={t("diag.lab.password")}
            type="password"
            autoComplete="off"
            value={password}
            onChange={setPassword}
            error={error}
            onEnter={() => password && void optIn()}
          />
          <Button full loading={busy} disabled={!password} onClick={optIn}>
            {t("diag.lab.allow")}
          </Button>
        </div>
      )}
    </div>
  );
}
