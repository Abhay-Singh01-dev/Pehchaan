// Shown if a screen fails to render. The common case after a new deploy is a code chunk that
// no longer exists ("Failed to fetch dynamically imported module"): reload once, automatically,
// to pick up the new version. Anything else gets a calm, branded screen with a Reload button.
// A chunk that failed because the phone is OFFLINE is different: reloading would only replace the app
// with the browser's "no internet" page, so the screen waits and reloads by itself once the network is back.
import { useEffect } from "react";
import { useRouteError } from "react-router";
import { Seal } from "@/components/Seal";

const RELOADED_KEY = "pehchaan:chunk-reload";

function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(
    msg,
  );
}

export function RouteError() {
  const error = useRouteError();
  const chunk = isChunkError(error);
  const offline = chunk && typeof navigator !== "undefined" && navigator.onLine === false;

  useEffect(() => {
    if (!chunk) return;
    if (!navigator.onLine) {
      const retry = () => window.location.reload();
      window.addEventListener("online", retry, { once: true });
      return () => window.removeEventListener("online", retry);
    }
    try {
      if (sessionStorage.getItem(RELOADED_KEY)) return; // already tried once: show the screen
      sessionStorage.setItem(RELOADED_KEY, "1");
    } catch {
      return;
    }
    window.location.reload();
  }, [chunk]);

  useEffect(() => {
    // A successful render later clears the flag, so future updates can reload once again.
    const id = window.setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOADED_KEY);
      } catch {
        /* ignore */
      }
    }, 10_000);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <main className="frame-bg grid min-h-app place-items-center px-6 text-center" role="alert">
      <div className="flex max-w-[320px] flex-col items-center">
        <Seal size={72} />
        <h1 className="mt-6 font-display text-h2 font-semibold text-ink">
          {offline ? "You're offline" : chunk ? "Pehchaan was updated" : "Something went wrong"}
        </h1>
        <p className="mt-2 text-body text-ink-2" lang="hi">
          {offline ? "आप ऑफ़लाइन हैं" : chunk ? "पहचान का नया संस्करण आया है" : "कुछ गड़बड़ हो गई"}
        </p>
        {offline && (
          <p className="mt-3 text-body-sm text-muted">
            This screen opens by itself when you're back online. · इंटरनेट लौटते ही यह अपने-आप खुल जाएगा।
          </p>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-8 h-14 w-full rounded-full bg-brand px-6 font-semibold text-on-brand"
        >
          Reload · फिर से खोलें
        </button>
      </div>
    </main>
  );
}
