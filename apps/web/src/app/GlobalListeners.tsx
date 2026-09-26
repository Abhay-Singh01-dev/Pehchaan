// Global listeners, mounted once at the family app root (spec B11):
//   relay.onRequest     → store it and open /request/:id with the takeover, from any screen
//   relay.onAlert       → store the alert and show the G1/G2 banner
//   relay.onGuardPrompt → show the B2 Call Guard banner
//   relay.onState       → the connection pill (via the session store)
// Plus: presence announcements, the verification controller, the PWA update toast.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { services } from "@/services";
import { useProfile } from "@/store/profile";
import { saveAlert } from "@/store/alerts";
import { haptic } from "@/design/haptics";
import { flags } from "./flags";
import { connectRelay } from "./bootstrap";
import { installVerificationController } from "./verification";
import { installAnsweringController, receiveRequest, sweepExpiredIncoming } from "./answering";
import { installContactSync } from "./contacts";
import { showBanner, toast, dismissToast } from "./ui";
import { useSession } from "./session";
import { isTakeoverScreen } from "./transitions";
import { applyUpdate, forceUpdate } from "./pwa";
import { onServiceWorkerMessage } from "./push";
import { getIncoming } from "@/store/requests";

export function GlobalListeners() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const profile = useProfile();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  // Relay connection + verification controller.
  useEffect(() => {
    const off = connectRelay();
    installVerificationController();
    installAnsweringController();
    installContactSync();
    return off;
  }, []);

  // Tell other devices who we are (name, and whether we can be verified).
  useEffect(() => {
    services.relay.announce({
      name: profile?.name ?? "",
      kind: "phone",
      canBeVerified: Boolean(profile?.keyId) && profile?.role === "can_be_verified",
    });
  }, [profile?.name, profile?.keyId, profile?.role]);

  // Incoming requests open F1 from anywhere (queued one at a time).
  useEffect(() => {
    return services.relay.onRequest(async (incoming) => {
      const myId = useSession.getState().deviceId;
      if (!myId || !(await receiveRequest(incoming, myId))) return;
      const req = incoming.req;
      const current = pathRef.current.match(/^\/request\/([^/]+)$/)?.[1];
      if (current) {
        const open = await getIncoming(current);
        if (open?.status === "pending") return; // F1 shows "1 more request"
      }
      navigate(`/request/${req.requestId}`);
    });
  }, [navigate]);

  // Family alerts (G1/G2).
  useEffect(() => {
    return services.relay.onAlert(async (alert) => {
      await saveAlert({ ...alert, read: false });
      haptic("error");
      showBanner({ id: alert.id, kind: "alert", alert });
    });
  }, []);

  // Call Guard prompts (B2).
  useEffect(() => {
    if (!flags.ENABLE_GUARD) return;
    return services.relay.onGuardPrompt((prompt) => {
      haptic("amber");
      showBanner({ id: `guard-${prompt.at}`, kind: "guard", prompt });
    });
  }, []);

  // A notification tap while the app was already open: the service worker focuses it and names the screen (11.5).
  useEffect(
    () =>
      onServiceWorkerMessage((m) => {
        const url = m.type === "navigate" ? m.url : null;
        // Only this app's own paths, as the service worker already checks.
        if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) navigate(url);
      }),
    [navigate],
  );

  // Expire old incoming requests.
  useEffect(() => {
    void sweepExpiredIncoming();
    const id = window.setInterval(() => void sweepExpiredIncoming(), 5000);
    return () => window.clearInterval(id);
  }, []);

  // PWA update: "Update ready · Reload" — never during D3, F1 or a verdict (B14).
  const updateReady = useSession((s) => s.updateReady);
  const busy = isTakeoverScreen(location.pathname);
  useEffect(() => {
    if (!updateReady || busy) return;
    const id = toast(t("pwa.updateReady"), {
      duration: 0,
      action: { label: t("pwa.reload"), onClick: applyUpdate },
    });
    return () => dismissToast(id);
  }, [updateReady, busy, t]);

  // FC-23: this version is too old for the relay. Nothing works until it updates, so the prompt stays.
  const updateRequired = useSession((s) => s.updateRequired);
  useEffect(() => {
    if (!updateRequired) return;
    const id = toast(t("pwa.updateRequired"), {
      duration: 0,
      action: { label: t("pwa.updateNow"), onClick: () => void forceUpdate() },
    });
    return () => dismissToast(id);
  }, [updateRequired, t]);

  return null;
}
