// J1 · Security Lab (spec B12 J1, B6.5). A laptop page where anyone — including a judge — plays
// an attacker who controls the relay, and sees every attack rejected. Keeps a permanent log of
// every attack ever run. Without attacker mode it only observes.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as m from "motion/react-m";
import { ArrowsClockwise, Broom, DownloadSimple, Ghost, Key, Skull, Swap } from "@phosphor-icons/react";
import { loadLab, services } from "@/services";
import { isRelayError } from "@/services/errors";
import type {
  AttackKind,
  ConnectionState,
  InvalidReason,
  LabService,
  LabStatus,
  PeerInfo,
  RelayEvent,
} from "@/services/types";
import { Button } from "@/components/Button";
import { Switch, TextField } from "@/components/controls";
import { flags } from "@/app/flags";
import { ConnectionPill } from "@/components/ConnectionPill";
import { RollingText } from "@/components/Rolling";
import { VerdictChip, Chip } from "@/components/VerdictChip";
import { LaptopHeader, LaptopNarrowNote } from "./LaptopShell";
import { Pipeline, type CapsuleSpec } from "./Pipeline";
import { TrafficLog } from "./TrafficLog";
import { useG } from "@/app/i18n";
import { formatDateLong } from "@/lib/format";
import { spring } from "@/design/motion";
import { cn } from "@/lib/cn";

const firstName = (p?: PeerInfo) => p?.name?.split(/\s+/)[0] || undefined;

export function Lab() {
  const { t, lang } = useG();
  const [lab, setLab] = useState<LabService | null>(null);
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [counters, setCounters] = useState({ attacks: 0, falseGreens: 0 });
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [events, setEvents] = useState<RelayEvent[]>([]);
  const [capsules, setCapsules] = useState<CapsuleSpec[]>([]);
  const [askerId, setAskerId] = useState<string>();
  const [targetId, setTargetId] = useState<string>();
  const [shield, setShield] = useState<"ok" | "block" | null>(null);
  const rolesRef = useRef({ askerId, targetId });
  rolesRef.current = { askerId, targetId };
  const manualRolesRef = useRef(false);
  const lastAttackRef = useRef<LabStatus["lastAttack"]>(null);
  // The real relay's Lab (14.1): the Lab password first; the forger may copy the target's real key ID (14.3).
  const [password, setPassword] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copyCredId, setCopyCredId] = useState(false);
  const [relayState, setRelayState] = useState<ConnectionState>("reconnecting");
  useEffect(() => (flags.SIM_RELAY ? undefined : services.relay.onState(setRelayState)), []);

  // Start the lab (own channel) once.
  useEffect(() => {
    let live: LabService | null = null;
    let offs: Array<() => void> = [];
    let cancelled = false;
    void loadLab().then((l) => {
      if (cancelled) return; // this effect was already cleaned up (StrictMode re-run)
      live = l;
      l.start();
      setLab(l);
      offs = [
        l.onStatus((s) => {
          setStatus(s);
          lastAttackRef.current = s.lastAttack;
        }),
        l.onCounters(setCounters),
        l.onPeers(setPeers),
        l.onTraffic((e) => onEvent(e)),
      ];
    });
    return () => {
      cancelled = true;
      offs.forEach((f) => f());
      live?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Roles follow the traffic (the latest request's asker and target) unless someone picks a
  // device by hand. Before any traffic: a checks-only phone asks, a verifiable phone answers.
  // Roles are sticky once known: a phone that reloads briefly leaves the presence list, and
  // must not flip the pipeline around.
  useEffect(() => {
    if (manualRolesRef.current || (askerId && targetId)) return;
    const phones = peers.filter((p) => p.kind === "phone");
    const a =
      askerId ??
      (phones.find((p) => p.canBeVerified === false) ?? phones.find((p) => p.deviceId !== targetId))?.deviceId;
    let b = targetId ?? phones.find((p) => p.canBeVerified && p.deviceId !== a)?.deviceId;
    if (b === a) b = undefined;
    if (a !== askerId) setAskerId(a);
    if (b !== targetId) setTargetId(b);
  }, [peers, askerId, targetId]);

  useEffect(() => {
    lab?.setRoles({ askerDeviceId: askerId, targetDeviceId: targetId });
  }, [lab, askerId, targetId]);

  const onEvent = useCallback((e: RelayEvent) => {
    setEvents((prev) => {
      const exists = prev.some((x) => x.id === e.id);
      return exists ? prev.map((x) => (x.id === e.id ? e : x)) : [e, ...prev].slice(0, 400);
    });
    // A request shows who is asking whom: follow it (unless roles were picked by hand).
    if (e.kind === "request" && !manualRolesRef.current) {
      const r = e.payload as { fromDeviceId?: string; toDeviceId?: string };
      if (r.fromDeviceId && r.toDeviceId) {
        rolesRef.current = { askerId: r.fromDeviceId, targetId: r.toDeviceId };
        setAskerId(r.fromDeviceId);
        setTargetId(r.toDeviceId);
      }
    }
    const { askerId: a, targetId: b } = rolesRef.current;
    if (e.verdictSeen) {
      // A report from Maa's phone: update the capsule, flash the shield.
      const reason =
        lastAttackRef.current?.requestId === e.requestId ? lastAttackRef.current?.invalidReason : undefined;
      setCapsules((cs) =>
        cs.map((c) => (c.event.id === e.id ? { ...c, verdict: e.verdictSeen, reason: reason ?? c.reason } : c)),
      );
      setShield(e.verdictSeen === "INVALID" ? "block" : "ok");
      window.setTimeout(() => setShield(null), 1300);
      return;
    }
    let path: CapsuleSpec["path"] | null = null;
    if (e.kind === "request" && e.to === "relay") path = "held";
    else if (e.from === "relay") path = "inject";
    else if (e.tampered === "change") path = "change";
    else if (e.from === a && e.to === b) path = "ltr";
    else if (e.from === b && e.to === a) path = "rtl";
    if (!path) return;
    setCapsules((cs) =>
      [...cs.filter((c) => c.event.id !== e.id), { id: `${e.id}-${Date.now()}`, event: e, path: path! }].slice(-12),
    );
  }, []);

  // Late-arriving invalid reasons (the status update can come after the traffic update).
  useEffect(() => {
    const la = status?.lastAttack;
    if (!la?.invalidReason) return;
    setCapsules((cs) =>
      cs.map((c) => (c.event.requestId === la.requestId && !c.reason ? { ...c, reason: la.invalidReason } : c)),
    );
  }, [status?.lastAttack]);

  const onCapsuleDone = useCallback((id: string) => setCapsules((cs) => cs.filter((c) => c.id !== id)), []);

  const askerLabel = firstName(peers.find((p) => p.deviceId === askerId)) ?? t("lab.fallbackAsker");
  const targetLabel = firstName(peers.find((p) => p.deviceId === targetId)) ?? t("lab.fallbackTarget");
  const reasonText = useCallback(
    (r?: InvalidReason) => (r ? t(`v.reasons.${r}`, { name: targetLabel }).replace(/\.$/, "") : t("v.fake.title")),
    [t, targetLabel],
  );

  const attacks: Array<{ kind: AttackKind; icon: ReactNode; title: string; body: string }> = useMemo(
    () => [
      {
        kind: "change",
        icon: <Swap size={28} weight="duotone" />,
        title: t("lab.change.title"),
        body: t("lab.change.body", { name: targetLabel }),
      },
      {
        kind: "replay",
        icon: <Ghost size={28} weight="duotone" />,
        title: t("lab.replay.title", { name: targetLabel }),
        body: t("lab.replay.body"),
      },
      {
        kind: "forge",
        icon: <Key size={28} weight="duotone" />,
        title: t("lab.forge.title"),
        body: t("lab.forge.body"),
      },
    ],
    [t, targetLabel],
  );

  const la = status?.lastAttack ?? null;
  const locked = Boolean(lab?.needsPassword && !status?.joined);
  const join = async () => {
    if (!lab?.join) return;
    setJoining(true);
    setJoinError(null);
    try {
      await lab.join(password);
      setPassword("");
    } catch (e) {
      const reason = isRelayError(e) ? e.reason : undefined;
      setJoinError(
        reason === "lab_denied"
          ? t("lab.join.wrong")
          : reason === "rate_limited"
            ? t("lab.join.limited")
            : reason === "lab_disabled"
              ? t("lab.join.off")
              : t("conn.offline"),
      );
    } finally {
      setJoining(false);
    }
  };
  const exportLog = async () => {
    if (!lab) return;
    const log = await lab.attackLog();
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), attacks: log }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pehchaan-attack-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="frame-bg min-h-app">
      <LaptopHeader title={t("lab.title")} tag={t("lab.tag")} danger={status?.attackerMode}>
        <span className="flex items-center gap-2 text-caption text-muted">
          {t("lab.relayStatus")}{" "}
          <ConnectionPill state={flags.SIM_RELAY ? (lab ? "connected" : "reconnecting") : relayState} />
        </span>
        <label className="flex items-center gap-3 rounded-full bg-surface-2 py-1.5 pl-4 pr-1.5">
          <span className={cn("text-body-sm font-semibold", status?.attackerMode ? "text-chip-no" : "text-ink")}>
            <Skull size={18} weight="duotone" className="-mt-0.5 mr-1.5 inline" aria-hidden />
            {t("lab.attacker")}
          </span>
          <Switch
            checked={Boolean(status?.attackerMode)}
            label={t("lab.attacker")}
            onChange={(v) => lab?.setAttackerMode(v)}
          />
        </label>
      </LaptopHeader>
      <LaptopNarrowNote text={t("lab.wide")} />

      <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-6 lg:px-8">
        {locked && (
          <section className="card max-w-[560px] p-6" aria-labelledby="lab-join">
            <h2 id="lab-join" className="font-display text-h2 font-semibold text-ink">
              {t("lab.join.title")}
            </h2>
            <p className="mt-2 text-body-sm text-ink-2">{t("lab.join.body")}</p>
            <div className="mt-4 flex flex-col gap-3">
              <TextField
                label={t("lab.join.password")}
                type="password"
                autoComplete="off"
                value={password}
                onChange={setPassword}
                error={joinError}
                onEnter={() => password && void join()}
              />
              <Button loading={joining} disabled={!password} onClick={join}>
                {t("lab.join.cta")}
              </Button>
            </div>
          </section>
        )}
        {!locked && lab?.needsPassword && peers.length === 0 && (
          <p className="card p-4 text-body-sm text-ink-2" role="status">
            {t("lab.noOptIns")}
          </p>
        )}
        {status?.notice === "held_timeout" && (
          <p className="text-body-sm font-medium text-ink-2" role="status">
            {t("lab.heldTimeout")}
          </p>
        )}
        {status?.attackerMode && (
          <m.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-body-sm font-semibold text-chip-no"
            role="status"
          >
            {t("lab.attackerOn")}
          </m.p>
        )}
        <Pipeline
          capsules={capsules}
          onCapsuleDone={onCapsuleDone}
          attacker={Boolean(status?.attackerMode)}
          armed={Boolean(status?.armed)}
          peers={peers}
          askerId={askerId}
          targetId={targetId}
          onAsker={(id) => {
            manualRolesRef.current = true;
            setAskerId(id);
          }}
          onTarget={(id) => {
            manualRolesRef.current = true;
            setTargetId(id);
          }}
          askerLabel={askerLabel}
          targetLabel={targetLabel}
          shield={shield}
          reasonText={reasonText}
        />

        {/* Attacks */}
        <section>
          <h2 className="mb-3 font-display text-h2 font-semibold text-ink">{t("lab.attacks")}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {attacks.map((a) => {
              const armed = status?.armed === a.kind;
              const disabled = locked || (a.kind === "replay" && !status?.canReplay);
              return (
                <m.div
                  key={a.kind}
                  className={cn("card relative flex flex-col p-5", armed && "shadow-[inset_0_0_0_2px_#E5463A]")}
                  animate={
                    armed
                      ? {
                          boxShadow: [
                            "inset 0 0 0 2px rgba(229,70,58,1)",
                            "inset 0 0 0 2px rgba(229,70,58,0.35)",
                            "inset 0 0 0 2px rgba(229,70,58,1)",
                          ],
                        }
                      : {}
                  }
                  transition={armed ? { duration: 1.6, repeat: Infinity } : undefined}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "grid h-12 w-12 place-items-center rounded-[14px]",
                        armed ? "bg-[#E5463A] text-white" : "bg-surface-2 text-ink-2",
                      )}
                    >
                      {a.icon}
                    </span>
                    <h3 className="font-display text-h3 font-semibold text-ink">{a.title}</h3>
                  </div>
                  <p className="mt-3 flex-1 text-body-sm text-ink-2">{a.body}</p>
                  {armed && (
                    <p className="mt-3 text-caption font-semibold text-chip-no" role="status">
                      {t("lab.armed", { name: askerLabel })}
                    </p>
                  )}
                  {!locked && a.kind === "replay" && !status?.canReplay && (
                    <p className="mt-3 text-caption text-muted">{t("lab.replay.disabled")}</p>
                  )}
                  {a.kind === "forge" && !armed && (
                    <label className="mt-3 flex items-center gap-2 text-caption text-ink-2">
                      <input
                        type="checkbox"
                        checked={copyCredId}
                        onChange={(e) => setCopyCredId(e.target.checked)}
                        className="h-4 w-4 accent-[var(--brand)]"
                      />
                      {t("lab.forge.copy", { name: targetLabel })}
                    </label>
                  )}
                  <Button
                    className="mt-4"
                    full
                    size="md"
                    variant={armed ? "danger-outline" : "primary"}
                    disabled={disabled || !lab}
                    onClick={() =>
                      armed ? lab?.disarm() : lab?.arm(a.kind, a.kind === "forge" ? { copyCredId } : undefined)
                    }
                  >
                    {armed ? t("lab.disarm") : t("lab.arm")}
                  </Button>
                </m.div>
              );
            })}
          </div>
        </section>

        {/* Result + counters */}
        <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="card p-6">
            <h2 className="text-caption font-semibold uppercase tracking-[0.06em] text-muted">{t("lab.result")}</h2>
            {!la ? (
              <p className="mt-3 text-h3 text-ink-2">{t("lab.resultIdle", { name: targetLabel, asker: askerLabel })}</p>
            ) : (
              <m.div
                key={la.id + (la.verdictSeen ?? "")}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring.soft}
              >
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Chip tone="fake" size="lg">
                    {t(`lab.attackNames.${la.attack}`)}
                  </Chip>
                  <span className="font-mono text-caption text-muted">
                    {new Date(la.at).toLocaleTimeString(lang === "hi" ? "hi-IN" : "en-IN")}
                  </span>
                </div>
                {la.verdictSeen ? (
                  <div className="mt-4">
                    <p className="flex flex-wrap items-center gap-3 font-display text-h1 font-semibold text-ink">
                      {t("lab.phoneShowed", { asker: askerLabel })} <VerdictChip verdict={la.verdictSeen} size="lg" />
                    </p>
                    {la.invalidReason && (
                      <p className="mt-3 text-h2 font-semibold text-ink">
                        {t(`v.reasons.${la.invalidReason}`, { name: targetLabel })}
                      </p>
                    )}
                    {la.failedChecks && la.failedChecks.length > 0 && (
                      <p className="mt-2 text-h3 text-ink-2">
                        {la.failedChecks.length === 1
                          ? t("lab.failedCheck", { n: la.failedChecks[0] })
                          : t("lab.failedChecks", { list: la.failedChecks.join(", ") })}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-4 text-h3 text-ink-2">{t("lab.resultWaiting", { asker: askerLabel })}</p>
                )}
              </m.div>
            )}
          </div>
          <div className="card grid grid-cols-2 gap-4 p-6">
            <div>
              <p className="text-caption font-semibold uppercase tracking-[0.06em] text-muted">{t("lab.attacksRun")}</p>
              <RollingText text={String(counters.attacks)} className="mt-2 text-[3.5rem] font-semibold text-ink" />
            </div>
            <div>
              <p className="text-caption font-semibold uppercase tracking-[0.06em] text-muted">
                {t("lab.falseGreens")}
              </p>
              <RollingText
                text={String(counters.falseGreens)}
                className="mt-2 text-[3.5rem] font-semibold text-chip-ok"
              />
            </div>
            <p className="col-span-2 text-caption text-muted">
              {status
                ? t("lab.since", {
                    date:
                      formatDateLong(status.since, lang) +
                      " " +
                      new Date(status.since).toLocaleTimeString(lang === "hi" ? "hi-IN" : "en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                  })
                : ""}
            </p>
          </div>
        </section>

        {/* Traffic log */}
        <section>
          <h2 className="mb-3 font-display text-h2 font-semibold text-ink">{t("lab.traffic")}</h2>
          <TrafficLog events={events} peers={peers} />
        </section>

        {/* Footer tools */}
        <footer className="flex flex-wrap gap-3 pb-10">
          <Button
            variant="secondary"
            size="md"
            icon={<Broom size={18} />}
            onClick={() => {
              lab?.clearLog();
              setEvents([]);
            }}
          >
            {t("lab.clearLog")}
          </Button>
          <Button variant="secondary" size="md" icon={<ArrowsClockwise size={18} />} onClick={() => lab?.reset()}>
            {t("lab.resetCounters")}
          </Button>
          <Button variant="secondary" size="md" icon={<DownloadSimple size={18} />} onClick={exportLog}>
            {t("lab.export")}
          </Button>
        </footer>
      </main>
    </div>
  );
}
