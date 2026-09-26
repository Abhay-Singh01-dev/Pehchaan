// ChecksList (spec B12.0, B6.4 #9): the 7 checks with plain-language labels. Each appears with a
// 70 ms stagger and its tick draws (stroke, 220 ms). A failed check draws a red ✕, its row tints
// red, with a tiny 4px shake. `animate={false}` renders it static (H2 after the first view).
import { useEffect, useState } from "react";
import * as m from "motion/react-m";
import { animate as animateValue } from "motion/react";
import { useTranslation } from "react-i18next";
import type { CheckResult, VerdictResult } from "@/services/types";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { useReduced } from "@/app/session";
import { ease } from "@/design/motion";
import { cn } from "@/lib/cn";

export function checkLabel(t: (k: string, o?: Record<string, unknown>) => string, c: CheckResult, name: string) {
  return t(`checks.${c.key}`, { n: c.params?.n ?? 0, name: c.params?.name ?? name });
}

function Mark({ passed, skipped, delay, play }: { passed: boolean; skipped?: boolean; delay: number; play: boolean }) {
  // Not checked (an unreadable seal, backend spec 9.4): a grey dash, neither a pass nor a failure.
  if (skipped) {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M7 12 H17" fill="none" stroke="var(--muted)" strokeWidth={2.8} strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  const color = passed ? "var(--chip-ok)" : "var(--chip-no)";
  const draw = (d = 0) =>
    play
      ? {
          initial: { pathLength: 0 },
          animate: { pathLength: 1 },
          transition: { duration: 0.22, delay: delay + d, ease: ease.out },
        }
      : {};
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
      style={{ background: `color-mix(in oklab, ${passed ? "var(--ok)" : "var(--no)"} 14%, transparent)` }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        {passed ? (
          <m.path
            d="M5 12.5 L10 17.5 L19 7.5"
            fill="none"
            stroke={color}
            strokeWidth={2.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...draw()}
          />
        ) : (
          <>
            <m.path
              d="M6.5 6.5 L17.5 17.5"
              fill="none"
              stroke={color}
              strokeWidth={2.8}
              strokeLinecap="round"
              {...draw()}
            />
            <m.path
              d="M17.5 6.5 L6.5 17.5"
              fill="none"
              stroke={color}
              strokeWidth={2.8}
              strokeLinecap="round"
              {...draw(0.08)}
            />
          </>
        )}
      </svg>
    </span>
  );
}

export function ChecksList({
  checks,
  name,
  animate = true,
  delay = 0.15,
}: {
  checks: CheckResult[];
  name: string;
  animate?: boolean;
  delay?: number;
}) {
  const { t } = useTranslation();
  const reduced = useReduced();
  const play = animate && !reduced;
  const sorted = [...checks].sort((a, b) => a.n - b.n);

  return (
    <ol className="flex flex-col gap-1.5">
      {sorted.map((c, i) => {
        const d = delay + i * 0.07;
        return (
          <m.li
            key={c.n}
            className={cn(
              "flex items-start gap-3 rounded-[14px] px-3 py-2.5",
              !c.passed && !c.skipped && "bg-[color-mix(in_oklab,var(--no)_9%,transparent)]",
            )}
            initial={play ? { opacity: 0, y: 6 } : false}
            animate={
              play && !c.passed && !c.skipped ? { opacity: 1, y: 0, x: [0, -4, 4, -2, 0] } : { opacity: 1, y: 0 }
            }
            transition={{
              opacity: { duration: 0.2, delay: d },
              y: { duration: 0.24, delay: d, ease: ease.out },
              x: { duration: 0.28, delay: d + 0.22 },
            }}
          >
            <Mark passed={c.passed} skipped={c.skipped} delay={d + 0.05} play={play} />
            <div className="min-w-0 flex-1 pt-1">
              <p
                className={cn(
                  "text-body-sm font-medium",
                  c.skipped ? "text-muted" : c.passed ? "text-ink" : "text-chip-no",
                )}
              >
                <span className="mr-1.5 font-mono text-caption text-muted">{c.n}</span>
                {checkLabel(t, c, name)}
              </p>
              {c.skipped ? (
                <p className="mt-0.5 text-caption text-muted">{t("checks.skipped")}</p>
              ) : (
                c.detail &&
                (!c.passed || c.detail === "late") && (
                  <p className="mt-0.5 text-caption text-ink-2">{t(`checks.fail.${c.detail}`, { name })}</p>
                )
              )}
            </div>
            <span className="sr-only">
              {c.skipped ? t("checks.skipped") : c.passed ? t("checks.passed") : t("checks.failed")}
            </span>
          </m.li>
        );
      })}
    </ol>
  );
}

/** Counts a number up from 0 (the "Answered in 3.8 s" timing line). */
function CountUp({ to, delay, decimals = 1 }: { to: number; delay: number; decimals?: number }) {
  const reduced = useReduced();
  const [v, setV] = useState(reduced ? to : 0);
  useEffect(() => {
    if (reduced) return;
    const c = animateValue(0, to, {
      duration: 0.8,
      delay,
      ease: ease.out,
      onUpdate: (x) => setV(x),
    });
    return () => c.stop();
  }, [to, delay, reduced]);
  return <span className="font-mono tabular-nums">{v.toFixed(decimals)}</span>;
}

/** E6 · Why? (spec B12 E6): dismissible, unlike the verdict itself. */
export function WhySheet({
  open,
  onClose,
  result,
  name,
}: {
  open: boolean;
  onClose: () => void;
  result: VerdictResult;
  name: string;
}) {
  const { t } = useTranslation();
  const failed = result.checks.filter((c) => !c.passed && !c.skipped).length;
  const title = result.verdict === "INVALID" ? t("why.titleFail") : t("why.titleTrust");
  const seconds = (result.elapsedMs ?? 0) / 1000;
  return (
    <Sheet open={open} onClose={onClose} labelledBy="why-title">
      <h2 id="why-title" className="font-display text-h2 font-semibold text-ink">
        {title}
      </h2>
      <p className={cn("mt-1 text-body-sm font-medium", failed ? "text-chip-no" : "text-chip-ok")}>
        {failed ? t("why.failedCount", { count: failed }) : t("why.allPassed")}
      </p>
      <div className="mt-4">
        <ChecksList checks={result.checks} name={name} />
      </div>
      {result.elapsedMs !== undefined && (
        <p className="mt-4 text-body text-ink">
          {t("why.answeredIn", { s: "\u0000" })
            .split("\u0000")
            .map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && <CountUp to={seconds} delay={0.2 + 7 * 0.07} />}
              </span>
            ))}
        </p>
      )}
      <p className="mt-3 text-body-sm text-muted">{t("why.footnote", { name })}</p>
      <Button className="mt-5" full variant="secondary" onClick={onClose}>
        {t("common.close")}
      </Button>
    </Sheet>
  );
}
