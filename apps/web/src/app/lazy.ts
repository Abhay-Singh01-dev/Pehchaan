// React.lazy for named exports, plus idle prefetching so lazy screens open instantly.
import { lazy, type ComponentType } from "react";

type Loader<T> = () => Promise<T>;

const loaders: Array<Loader<unknown>> = [];

export function lazyNamed<M extends Record<string, unknown>, K extends keyof M>(load: Loader<M>, name: K) {
  loaders.push(load);
  return lazy(async () => ({ default: (await load())[name] as ComponentType<unknown> })) as unknown as M[K];
}

const critical: Array<Loader<unknown>> = [];

/** Screens that must open even if the network drops a moment later: asking (D1–D3), the verdict (E1–E5) and
 *  the answer takeover (F1–F3). Loaded as soon as the app starts, not at idle, and even on data saver. */
export function markCritical(...loads: Array<Loader<unknown>>) {
  critical.push(...loads);
}

export function preloadCritical() {
  for (const load of critical) void load().catch(() => {});
}

/** Warms every lazy screen chunk once the app is idle (skipped on data saver). */
export function prefetchScreens() {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  const idle =
    (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
  let i = 0;
  const next = () => {
    const load = loaders[i++];
    if (!load) return;
    void load()
      .catch(() => {})
      .finally(() => idle(next, { timeout: 3000 }));
  };
  idle(next, { timeout: 3000 });
}
