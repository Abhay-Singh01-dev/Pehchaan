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
import { receiveRequest, sweepExpiredIncoming } from "./answering";
import { showBanner, toast, dismissToast } from "./ui";
import { useSession } from "./session";
import { isTakeoverScreen } from "./transitions";
import { applyUpdate } from "./pwa";
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
    return services.relay.onRequest(async (req) => {
      const myId = useSession.getState().deviceId;
      if (!myId || !(await receiveRequest(req, myId))) return;
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

  return null;
}
