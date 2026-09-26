// J1 · The Lab's pipeline (spec B6.5): Maa's phone · Relay · Arjun's phone. Messages travel as
// small labelled capsules along the line (700 ms). When an attack is armed the Relay turns red
// with a slow static-noise texture. A tampered capsule visibly mutates in the Relay: "change"
// flips NOT ME → ME with a glitch; "replay" is a ghost copy from history; "forge" carries a
// different key colour. On arrival at Maa's node a shield flashes and the capsule bounces off
// and shatters into fragments, then "Rejected: {reason}" appears.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { CellSignalFull, DeviceMobile, ShieldCheck, ShieldSlash } from "@phosphor-icons/react";
import type { PeerInfo, RelayEvent, WireAnswer, VerifyRequest, Verdict, InvalidReason } from "@/services/types";
import { ease } from "@/design/motion";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface CapsuleSpec {
  id: string;
  event: RelayEvent;
  /** Which way it travels and where it starts. */
  path: "ltr" | "rtl" | "held" | "change" | "inject";
  verdict?: Verdict;
  reason?: InvalidReason;
}

const NODE_X = [0.11, 0.5, 0.89];

function capsuleLabel(e: RelayEvent): string {
  if (e.kind === "answer") return (e.payload as WireAnswer).decision === "ME" ? "ME" : "NOT ME";
  if (e.kind === "request") {
    const r = e.payload as VerifyRequest;
    return r.amountInr ? formatINR(r.amountInr) : "request";
  }
  return e.kind;
}

function Particles({ x, y }: { x: number; y: number }) {
  const bits = Array.from({ length: 11 }, (_, i) => {
    const a = (i / 11) * Math.PI * 2 + Math.random() * 0.4;
    const d = 26 + Math.random() * 34;
    return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: Math.random() * 180 };
  });
  return (
    <>
      {bits.map((b, i) => (
        <m.span
          key={i}
          aria-hidden
          className="absolute h-2 w-2 rounded-[2px] bg-[#E5463A]"
          style={{ left: x, top: y }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
          animate={{ x: b.dx + 18, y: b.dy, opacity: 0, rotate: b.r, scale: 0.5 }}
          transition={{ duration: 0.5, ease: ease.out }}
        />
      ))}
    </>
  );
}

function Capsule({
  spec,
  width,
  onDone,
  reasonText,
}: {
  spec: CapsuleSpec;
  width: number;
  onDone: (id: string) => void;
  reasonText: (r?: InvalidReason) => string;
}) {
  const { t } = useTranslation();
  const [x0, x1, x2] = NODE_X.map((f) => f * width) as [number, number, number];
  const e = spec.event;
  const tampered = Boolean(e.tampered);
  const [flipped, setFlipped] = useState(false);
  const [phase, setPhase] = useState<"travel" | "arrived" | "gone">("travel");
  const label = capsuleLabel(e);
  const shownLabel = spec.path === "change" && flipped ? (label === "ME" ? "NOT ME" : "ME") : label;
  const rejected = spec.verdict === "INVALID";

  let xs: number[];
  let times: number[] | undefined;
  let duration = 0.7;
  switch (spec.path) {
    case "ltr":
      xs = [x0, x2];
      break;
    case "rtl":
      xs = [x2, x0];
      break;
    case "held":
      xs = [x0, x1];
      duration = 0.4;
      break;
    case "change":
      xs = [x2, x1, x1, x0];
      times = [0, 0.33, 0.62, 1];
      duration = 1.1;
      break;
    case "inject":
      xs = [x1, x0];
      duration = 0.55;
      break;
  }

  useEffect(() => {
    if (spec.path !== "change") return;
    const id = window.setTimeout(() => setFlipped(true), 520);
    return () => window.clearTimeout(id);
  }, [spec.path]);

  // Wait at Maa's node for her phone's verdict, then shatter (rejected) or be absorbed.
  useEffect(() => {
    if (phase !== "arrived") return;
    const endsAtMaa = spec.path === "rtl" || spec.path === "change" || spec.path === "inject";
    if (!endsAtMaa || !tampered) {
      const id = window.setTimeout(() => setPhase("gone"), 150);
      return () => window.clearTimeout(id);
    }
    if (spec.verdict) {
      const id = window.setTimeout(() => setPhase("gone"), rejected ? 1600 : 400);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setPhase("gone"), 2500);
    return () => window.clearTimeout(id);
  }, [phase, spec.verdict, spec.path, tampered, rejected]);

  useEffect(() => {
    if (phase === "gone") onDone(spec.id);
  }, [phase, onDone, spec.id]);

  const colour =
    spec.path === "inject" && e.tampered === "forge"
      ? "bg-[#E07B39] text-white"
      : spec.path === "inject" && e.tampered === "replay"
        ? "bg-white/10 text-white shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.7)] [border-style:dashed]"
        : e.kind === "answer"
          ? label === "ME"
            ? "bg-[#12A35C] text-white"
            : "bg-[#E5463A] text-white"
          : e.kind === "request"
            ? "bg-[#8C95FF] text-[#0A0E1F]"
            : "bg-[#D9B874] text-[#1F1300]";

  const shatter = phase === "arrived" && tampered && rejected && spec.path !== "held" && spec.path !== "ltr";

  return (
    <>
      <AnimatePresence>
        {!shatter && phase !== "gone" && (
          <m.div
            className="pointer-events-none absolute top-1/2 z-10 -translate-y-1/2"
            initial={{ x: xs[0], opacity: 0, scale: 0.9 }}
            animate={{
              x: xs,
              opacity: spec.path === "held" && phase === "arrived" ? 0 : 1,
              scale: spec.path === "held" && phase === "arrived" ? 0.2 : 1,
            }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{
              x: { duration, times, ease: ease.inOut },
              opacity: { duration: 0.2 },
              scale: { duration: 0.3 },
            }}
            onAnimationComplete={() => phase === "travel" && setPhase("arrived")}
          >
            <m.span
              className={cn(
                "relative -ml-[50%] inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 font-mono text-[13px] font-semibold shadow-[0_6px_18px_rgba(0,0,0,0.35)]",
                colour,
                spec.path === "inject" && e.tampered === "replay" && "opacity-80",
              )}
              animate={
                spec.path === "change" && flipped
                  ? { x: [0, -3, 3, -2, 0], filter: ["none", "hue-rotate(90deg)", "none"] }
                  : {}
              }
              transition={{ duration: 0.25 }}
            >
              {e.tampered === "forge" && <span aria-hidden className="h-2 w-2 rounded-full bg-[#1F1300]" />}
              {shownLabel}
            </m.span>
          </m.div>
        )}
      </AnimatePresence>
      {shatter && (
        <>
          <Particles x={x0} y={0} />
          <m.div
            className="pointer-events-none absolute z-30 w-60 -translate-x-1/2 text-center"
            style={{ left: x0, top: -86 }}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className="inline-block rounded-full bg-[#8E1B12] px-3 py-1 text-caption font-semibold text-white">
              {t("lab.rejected", { reason: reasonText(spec.reason) })}
            </span>
          </m.div>
        </>
      )}
    </>
  );
}

function Node({
  x,
  label,
  sub,
  peers,
  value,
  onChange,
  icon,
  shield,
  attacker,
}: {
  x: number;
  label: string;
  sub?: string;
  peers?: PeerInfo[];
  value?: string;
  onChange?: (id: string) => void;
  icon: ReactNode;
  shield?: "ok" | "block" | null;
  attacker?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="absolute top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ left: x }}
    >
      <div
        className={cn(
          "relative grid h-20 w-20 place-items-center overflow-hidden rounded-[24px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] transition-colors duration-500",
          attacker ? "bg-[#8E1B12] text-white" : "bg-surface text-ink dark:bg-[#1A2146]",
        )}
      >
        {attacker && (
          <span
            aria-hidden
            className="absolute -inset-8 opacity-40 mix-blend-screen"
            style={{
              backgroundImage: "var(--noise)",
              backgroundSize: "90px 90px",
              animation: "static-noise 1.2s steps(4) infinite",
            }}
          />
        )}
        <span className="relative">{icon}</span>
        <AnimatePresence>
          {shield && (
            <m.span
              key={shield}
              className={cn(
                "absolute inset-0 grid place-items-center",
                shield === "block" ? "bg-[#C4291C]" : "bg-[#087A45]",
              )}
              initial={{ opacity: 0, scale: 1.3 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {shield === "block" ? (
                <ShieldSlash size={36} weight="duotone" color="#fff" />
              ) : (
                <ShieldCheck size={36} weight="duotone" color="#fff" />
              )}
            </m.span>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-2 whitespace-nowrap text-center text-body-sm font-semibold text-ink">{label}</div>
      {sub && <div className={cn("text-caption font-semibold", attacker ? "text-chip-no" : "text-muted")}>{sub}</div>}
      {peers && onChange && (
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          aria-label={t("lab.pickDevice")}
          className="mt-1.5 h-9 max-w-[180px] rounded-full bg-surface-2 px-3 text-caption font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none"
        >
          {peers.length === 0 && !value && <option value="">{t("lab.noDevices")}</option>}
          {/* Keep showing the chosen phone while it's momentarily reconnecting. */}
          {value && !peers.some((p) => p.deviceId === value) && <option value={value}>{value}</option>}
          {peers.map((p) => (
            <option key={p.deviceId} value={p.deviceId}>
              {p.name || p.deviceId} · {p.deviceId}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function Pipeline({
  capsules,
  onCapsuleDone,
  attacker,
  armed,
  peers,
  askerId,
  targetId,
  onAsker,
  onTarget,
  askerLabel,
  targetLabel,
  shield,
  reasonText,
}: {
  capsules: CapsuleSpec[];
  onCapsuleDone: (id: string) => void;
  attacker: boolean;
  armed: boolean;
  peers: PeerInfo[];
  askerId?: string;
  targetId?: string;
  onAsker: (id: string) => void;
  onTarget: (id: string) => void;
  askerLabel: string;
  targetLabel: string;
  shield: "ok" | "block" | null;
  reasonText: (r?: InvalidReason) => string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const phones = peers.filter((p) => p.kind === "phone");
  const [x0, x1, x2] = NODE_X.map((f) => f * width) as [number, number, number];

  return (
    <div
      ref={ref}
      className={cn(
        "card relative h-[240px] overflow-hidden transition-shadow duration-500",
        armed && "shadow-[inset_0_0_0_2px_#E5463A]",
      )}
    >
      <div className="absolute inset-x-0 top-1/2 -translate-y-[calc(50%+18px)]">
        <div className="relative h-0">
          {/* The two wires */}
          <svg className="absolute left-0 top-0 overflow-visible" width={width} height="1" aria-hidden>
            <line
              x1={x0 + 44}
              x2={x1 - 44}
              y1={0}
              y2={0}
              stroke="var(--line)"
              strokeWidth={3}
              strokeDasharray="2 8"
              strokeLinecap="round"
            />
            <line
              x1={x1 + 44}
              x2={x2 - 44}
              y1={0}
              y2={0}
              stroke="var(--line)"
              strokeWidth={3}
              strokeDasharray="2 8"
              strokeLinecap="round"
            />
          </svg>
          {capsules.map((c) => (
            <Capsule key={c.id} spec={c} width={width} onDone={onCapsuleDone} reasonText={reasonText} />
          ))}
          <Node
            x={x0}
            label={t("lab.asker", { name: askerLabel })}
            icon={<DeviceMobile size={36} weight="duotone" />}
            peers={phones}
            value={askerId}
            onChange={onAsker}
            shield={shield}
          />
          <Node
            x={x1}
            label={t("lab.relay")}
            sub={attacker ? t("lab.controlled") : t("lab.observing")}
            icon={<CellSignalFull size={34} weight="duotone" />}
            attacker={attacker}
          />
          <Node
            x={x2}
            label={t("lab.asker", { name: targetLabel })}
            icon={<DeviceMobile size={36} weight="duotone" />}
            peers={phones}
            value={targetId}
            onChange={onTarget}
          />
        </div>
      </div>
    </div>
  );
}
