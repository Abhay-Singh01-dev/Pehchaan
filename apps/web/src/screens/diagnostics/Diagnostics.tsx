// J3 · Diagnostics (spec B12 J3). Hidden: tap the version number 5 times in Settings.
// Device, connection (with ping), last verdict, tools, and — in simulation mode only — the
// Simulation panel (auto-answer, forced connection state, key-creation outcome, example family,
// "Open as Maa / Arjun").
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  Broom,
  Copy,
  Flask,
  Lightning,
  ShieldWarning,
  UsersThree,
  Waveform,
} from "@phosphor-icons/react";
import { services, simControls } from "@/services";
import type { AutoAnswerMode, ConnectionState, KeyOutcome } from "@/services/types";
import { Button } from "@/components/Button";
import { ChecksList } from "@/components/ChecksList";
import { ConnectionPill } from "@/components/ConnectionPill";
import { InlineConfirm } from "@/components/InlineConfirm";
import { copyText } from "@/components/PhoneNumber";
import { VerdictChip } from "@/components/VerdictChip";
import { PageBody, PageTitle, Section } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useProfile } from "@/store/profile";
import { useLastResult } from "@/store/requests";
import { clearRequestsAndHistory } from "@/store/maintenance";
import { loadExampleFamily } from "@/store/seed";
import { APP_VERSION, flags } from "@/app/flags";
import { device } from "@/app/device";
import { useSession } from "@/app/session";
import { toast } from "@/app/ui";
import { useG } from "@/app/i18n";
import { formatClock, relativeTime } from "@/lib/format";
import { spring } from "@/design/motion";
import { cn } from "@/lib/cn";

function Row({ label, value, mono, action }: { label: string; value: ReactNode; mono?: boolean; action?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
      <span className="w-[38%] shrink-0 text-body-sm text-muted">{label}</span>
      <span className={cn("min-w-0 flex-1 break-all text-body-sm font-medium text-ink", mono && "font-mono")}>{value}</span>
      {action}
    </div>
  );
}

function Radio<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="card divide-y divide-line overflow-hidden">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2"
          >
            <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full", on ? "bg-brand" : "shadow-[inset_0_0_0_2px_var(--line)]")}>
              {on && <m.span layoutId={`radio-${name}`} className="h-2 w-2 rounded-full bg-on-brand" transition={spring.ui} />}
            </span>
            <span className="text-body-sm font-medium text-ink">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Diagnostics() {
  const { t, lang } = useG();
  const navigate = useNavigate();
  const profile = useProfile();
  const last = useLastResult();
  const { deviceId, connection, reachable, peers } = useSession();
  const [rtt, setRtt] = useState<number | null>(null);
  const [pinging, setPinging] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [auto, setAuto] = useState<AutoAnswerMode | null>(null);
  const [outcome, setOutcome] = useState<KeyOutcome | null>(null);
  const [forced, setForced] = useState<ConnectionState | null>(simControls?.forcedConnection() ?? null);
  const [, tick] = useState(0);

  useEffect(() => {
    void simControls?.getAutoAnswer().then(setAuto);
    void simControls?.getKeyOutcome().then(setOutcome);
    const id = window.setInterval(() => tick((n) => n + 1), 2000);
    return () => window.clearInterval(id);
  }, []);

  const lastMsg = services.relay.lastMessageAt();
  const peerName = (id: string) => peers.find((p) => p.deviceId === id)?.name || id;

  const debugInfo = () =>
    JSON.stringify(
      {
        app: APP_VERSION,
        device: { id: deviceId, db: device.dbName, sim: device.simName },
        flags,
        profile: profile ? { name: profile.name, role: profile.role, key: Boolean(profile.keyId), lang: profile.lang } : null,
        connection: { state: connection, relay: services.relay.address(), rttMs: rtt, lastMessageAt: lastMsg },
        reachable,
        lastVerdict: last?.result ? { verdict: last.result.verdict, reason: last.result.invalidReason ?? last.result.noResponseReason } : null,
        userAgent: navigator.userAgent,
      },
      null,
      2,
    );

  return (
    <>
      <TopBar title={t("diag.title")} />
      <PageBody>
        <PageTitle>{t("diag.title")}</PageTitle>

        <Section title={t("diag.device")} className="mt-0">
          <div className="card divide-y divide-line">
            <Row label={t("diag.name")} value={profile?.name ?? "—"} />
            <Row
              label={t("diag.deviceId")}
              value={deviceId}
              mono
              action={
                <button
                  type="button"
                  aria-label={t("common.copy")}
                  className="grid h-10 w-10 place-items-center rounded-full text-muted active:bg-surface-2"
                  onClick={async () => deviceId && (await copyText(deviceId)) && toast(t("common.copied"), { tone: "success" })}
                >
                  <Copy size={18} />
                </button>
              }
            />
            <Row label={t("diag.role")} value={profile ? t(`settings.role.${profile.role}`) : "—"} />
            <Row label={t("diag.keyStatus")} value={profile?.keyId ? `${t("diag.keyReady")} · ${profile.keyId.slice(0, 14)}…` : t("diag.keyNone")} />
            <Row label={t("diag.version")} value={APP_VERSION} mono />
            <Row
              label={t("diag.flags")}
              mono
              value={Object.entries(flags)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ")}
            />
            {device.simName && <Row label={t("diag.simName")} value={`?device=${device.simName}`} mono />}
          </div>
        </Section>

        <Section title={t("diag.connection")}>
          <div className="card divide-y divide-line">
            <Row label={t("diag.state")} value={<ConnectionPill state={connection} />} />
            <Row label={t("diag.relay")} value={services.relay.address()} />
            <Row
              label={t("diag.rtt")}
              value={rtt !== null ? `${rtt} ms` : "—"}
              mono
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pinging}
                  onClick={async () => {
                    setPinging(true);
                    try {
                      setRtt(await services.relay.ping());
                    } catch {
                      setRtt(null);
                      toast(t("conn.offline"), { tone: "error" });
                    } finally {
                      setPinging(false);
                    }
                  }}
                >
                  {t("diag.ping")}
                </Button>
              }
            />
            <Row label={t("diag.lastMessage")} value={lastMsg ? `${formatClock(lastMsg)} · ${relativeTime(lastMsg, lang)}` : t("diag.never")} />
            <Row label={t("diag.reachable")} value={reachable.length ? reachable.map(peerName).join(", ") : t("diag.none")} />
          </div>
        </Section>

        <Section title={t("diag.lastVerdict")}>
          {last?.result ? (
            <div className="card p-3">
              <div className="flex items-center gap-2 px-1 pb-2">
                <VerdictChip verdict={last.result.verdict} />
                <span className="text-body-sm text-ink-2">{last.memberLabel || t("verify.someone")}</span>
                <span className="ml-auto font-mono text-caption text-muted">{formatClock(last.result.decidedAt)}</span>
              </div>
              {last.result.checks.length > 0 && <ChecksList checks={last.result.checks} name={last.memberLabel} animate={false} />}
            </div>
          ) : (
            <p className="card p-4 text-body-sm text-muted">{t("diag.noVerdict")}</p>
          )}
        </Section>

        <Section title={t("diag.tools")}>
          <div className="flex flex-col gap-2.5">
            {!confirmClear && (
              <Button full variant="danger-outline" icon={<Broom size={20} />} onClick={() => setConfirmClear(true)}>
                {t("diag.clear")}
              </Button>
            )}
            <InlineConfirm
              open={confirmClear}
              danger
              message={t("diag.clearConfirm")}
              confirmLabel={t("diag.clearCta")}
              cancelLabel={t("common.cancel")}
              onCancel={() => setConfirmClear(false)}
              onConfirm={async () => {
                await clearRequestsAndHistory();
                setConfirmClear(false);
                toast(t("diag.cleared"), { tone: "success" });
              }}
            />
            <Button
              full
              variant="secondary"
              icon={<ShieldWarning size={20} />}
              onClick={async () => {
                await services.verifier.resetUsedNonces();
                toast(t("diag.noncesReset"), { tone: "success" });
              }}
            >
              {t("diag.resetNonces")}
            </Button>
            <Button full variant="secondary" icon={<ArrowsClockwise size={20} />} onClick={() => services.relay.reconnect()}>
              {t("diag.reconnect")}
            </Button>
            <Button
              full
              variant="secondary"
              icon={<Copy size={20} />}
              onClick={async () => {
                if (await copyText(debugInfo())) toast(t("diag.debugCopied"), { tone: "success" });
              }}
            >
              {t("diag.copyDebug")}
            </Button>
          </div>
        </Section>

        {flags.SIMULATION && simControls && (
          <Section
            title={
              <span className="inline-flex items-center gap-2">
                <Flask size={20} weight="duotone" className="text-brand" /> {t("diag.simulation")}
              </span>
            }
          >
            <div className="flex flex-col gap-5">
              <div>
                <p className="mb-2 text-body-sm font-medium text-ink-2">{t("diag.autoAnswer")}</p>
                <Radio
                  name="auto"
                  value={auto}
                  onChange={async (v) => {
                    setAuto(v);
                    await simControls!.setAutoAnswer(v);
                  }}
                  options={(["off", "not_me", "yes", "never", "tamper_changed", "tamper_reused", "tamper_wrong_key"] as const).map((v) => ({
                    value: v,
                    label: t(`diag.auto.${v}`),
                  }))}
                />
              </div>
              <div>
                <p className="mb-2 text-body-sm font-medium text-ink-2">{t("diag.force")}</p>
                <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                  {([null, "connected", "reconnecting", "offline"] as const).map((s) => (
                    <Button
                      key={String(s)}
                      size="md"
                      variant={forced === s ? "primary" : "secondary"}
                      onClick={() => {
                        simControls!.forceConnection(s);
                        setForced(s);
                      }}
                    >
                      {s ? t(`conn.${s}`) : t("diag.forceNone")}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-body-sm font-medium text-ink-2">{t("diag.keyOutcome")}</p>
                <Radio
                  name="outcome"
                  value={outcome}
                  onChange={async (v) => {
                    setOutcome(v);
                    await simControls!.setKeyOutcome(v);
                  }}
                  options={(["success", "no_screen_lock", "no_passkeys", "cancelled"] as const).map((v) => ({
                    value: v,
                    label: t(`diag.outcome.${v}`),
                  }))}
                />
              </div>
              <Button
                full
                variant="secondary"
                icon={<UsersThree size={20} />}
                onClick={async () => {
                  if (!deviceId) return;
                  const n = await loadExampleFamily(deviceId);
                  toast(t("diag.familyLoaded", { count: n }), { tone: "success" });
                }}
              >
                {t("diag.loadFamily")}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["maa", t("howItWorks.exampleAsker")],
                  ["arjun", t("howItWorks.examplePerson")],
                ].map(([d, label]) => (
                  <a
                    key={d}
                    href={`/?device=${d}`}
                    target="_blank"
                    rel="noreferrer"
                    className="card inline-flex min-h-12 items-center justify-center gap-2 px-3 text-body-sm font-semibold text-brand-ink"
                  >
                    <ArrowSquareOut size={18} aria-hidden /> {t("diag.openAs", { name: label })}
                  </a>
                ))}
                {flags.ENABLE_LAB && (
                  <a href="/lab?device=lab" target="_blank" rel="noreferrer" className="card inline-flex min-h-12 items-center justify-center gap-2 px-3 text-body-sm font-semibold text-brand-ink">
                    <Lightning size={18} aria-hidden /> {t("diag.openLab")}
                  </a>
                )}
                {flags.ENABLE_GUARD && (
                  <a href="/guard?device=guard" target="_blank" rel="noreferrer" className="card inline-flex min-h-12 items-center justify-center gap-2 px-3 text-body-sm font-semibold text-brand-ink">
                    <Waveform size={18} aria-hidden /> {t("diag.openGuard")}
                  </a>
                )}
              </div>
            </div>
          </Section>
        )}
        <Button className="mt-8" full variant="ghost" onClick={() => navigate("/settings")}>
          {t("common.done")}
        </Button>
      </PageBody>
    </>
  );
}
