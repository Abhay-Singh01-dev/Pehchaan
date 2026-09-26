// Pull to refresh (spec B6.3): the seal rotates with the pull distance and "presses" when
// released. Works on the screen's own scroll container (touch only, at the very top).
import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import * as m from "motion/react-m";
import { animate, useMotionValue, useTransform } from "motion/react";
import { useTranslation } from "react-i18next";
import { Seal } from "./Seal";
import { spring } from "@/design/motion";
import { haptic } from "@/design/haptics";
import { useReduced } from "@/app/session";

const THRESHOLD = 72;
const MAX = 120;

export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void>; children: ReactNode }) {
  const { t } = useTranslation();
  const reduced = useReduced();
  const pull = useMotionValue(0);
  const rotate = useTransform(pull, (p) => p * 2.4);
  const opacity = useTransform(pull, [0, 24, THRESHOLD], [0, 0.5, 1]);
  const y = useTransform(pull, (p) => Math.min(p, MAX) * 0.55 - 28);
  const contentY = useTransform(pull, (p) => p * 0.6);
  const start = useRef<{ y: number; scroller: HTMLElement | null } | null>(null);
  const armed = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [label, setLabel] = useState<"pull" | "release">("pull");

  const onTouchStart = (e: TouchEvent) => {
    if (refreshing) return;
    const scroller = (e.currentTarget as HTMLElement).closest(".scroll-y") as HTMLElement | null;
    if (scroller && scroller.scrollTop > 0) return;
    start.current = { y: e.touches[0]!.clientY, scroller };
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!start.current) return;
    const dy = e.touches[0]!.clientY - start.current.y;
    if (dy <= 0 || (start.current.scroller && start.current.scroller.scrollTop > 0)) {
      pull.set(0);
      return;
    }
    // Resistance grows with distance.
    const p = Math.min(MAX, dy * 0.5);
    pull.set(p);
    const past = p >= THRESHOLD;
    if (past !== armed.current) {
      armed.current = past;
      setLabel(past ? "release" : "pull");
      if (past) haptic("chip");
    }
  };

  const onTouchEnd = async () => {
    if (!start.current) return;
    start.current = null;
    if (armed.current) {
      armed.current = false;
      setRefreshing(true);
      void animate(pull, 64, spring.soft);
      await onRefresh();
      setRefreshing(false);
    }
    setLabel("pull");
    void animate(pull, 0, spring.soft);
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className="relative"
    >
      <m.div
        aria-hidden={!refreshing}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center"
        style={{ y, opacity }}
      >
        <m.div
          style={{ rotate: reduced ? 0 : rotate }}
          animate={refreshing && !reduced ? { scale: [1, 0.82, 1] } : { scale: 1 }}
          transition={
            refreshing ? { duration: 0.5, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.2 } : spring.stamp
          }
        >
          <Seal size={32} state={refreshing ? "waiting" : "brand"} />
        </m.div>
        <span className="mt-1 text-caption text-muted">
          {label === "release" ? t("home.releaseToRefresh") : t("home.pullToRefresh")}
        </span>
      </m.div>
      <m.div style={{ y: contentY }}>{children}</m.div>
    </div>
  );
}
