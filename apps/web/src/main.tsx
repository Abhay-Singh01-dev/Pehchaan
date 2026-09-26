import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { applyBootDisplay } from "./app/theme";
import { initI18n } from "./app/i18n";
import { installOriginTracker } from "./design/origin";
import { installAudioUnlock } from "./design/sounds";
import { installPwa } from "./app/pwa";
import { App } from "./app/App";

// Dev builds only: expose the service layer for debugging and end-to-end tests.
if (import.meta.env.DEV) {
  void Promise.all([
    import("./services"),
    import("./store/profile"),
    import("./services/card"),
    import("./services/identity"),
  ]).then(([{ services, simControls }, { setPrefs, getProfile }, { myCard }, { ensureIdentity }]) => {
    (window as unknown as { __pehchaan: unknown }).__pehchaan = {
      services,
      simControls,
      setPrefs,
      /** This device's family link (what "Copy link" on My code copies). */
      myLink: async () => {
        const p = await getProfile();
        return p ? services.card.toLink(myCard(p, await ensureIdentity())) : null;
      },
    };
  });
}

// Theme, text size and language before the first frame.
applyBootDisplay();
installOriginTracker();
installAudioUnlock();
installPwa();

// The active language's strings load first (one small chunk), then the app renders.
void initI18n().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
