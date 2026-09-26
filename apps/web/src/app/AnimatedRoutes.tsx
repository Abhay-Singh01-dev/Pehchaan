// The transition stage: keeps the outgoing screen mounted while the new one animates in.
// Each copy renders <Routes> with its own location, so exiting screens keep their params.
import { useMemo, useRef } from "react";
import { Routes, useLocation, type Location } from "react-router";
import { AnimatePresence } from "motion/react";
import { familyRoutes } from "./routes";
import { RouteFrame } from "./RouteFrame";
import { transitionFor, type TransitionKind } from "./transitions";
import { useReduced } from "./session";

function historyIndex(): number {
  return (window.history.state as { idx?: number } | null)?.idx ?? 0;
}

function useTransitionKind(location: Location): TransitionKind {
  const prev = useRef<{ path: string; idx: number; key: string } | null>(null);
  const cache = useRef<{ key: string; kind: TransitionKind } | null>(null);
  if (cache.current?.key === location.key) return cache.current.kind;
  const idx = historyIndex();
  const from = prev.current;
  const direction = from && idx < from.idx ? "back" : "forward";
  const kind = transitionFor(from?.path ?? null, location.pathname, direction);
  prev.current = { path: location.pathname, idx, key: location.key };
  cache.current = { key: location.key, kind };
  return kind;
}

export function AnimatedRoutes() {
  const location = useLocation();
  const reduced = useReduced();
  const kind = useTransitionKind(location);
  const routes = useMemo(() => familyRoutes(), []);

  return (
    <AnimatePresence initial={false} custom={{ kind, reduced }}>
      <RouteFrame key={location.pathname} kind={kind} reduced={reduced}>
        <Routes location={location}>{routes}</Routes>
      </RouteFrame>
    </AnimatePresence>
  );
}
