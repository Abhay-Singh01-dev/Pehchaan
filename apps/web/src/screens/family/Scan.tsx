// C4 · Scan their code (spec B12 C4, B6.4 #5). Lazy chunk (qr-scanner).
//   Brackets breathe (scale 1 → 1.03) and a soft scan line glides top to bottom. On success the
//   brackets snap to the code's bounds (spring.ui), a check bursts from the centre, and the view
//   crossfades to the confirm screen with the member's avatar growing from the code's position.
//   Errors: camera refused, not a Pehchaan code (brackets shake + toast), own code, already added.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import QrScanner from "qr-scanner";
import { CameraSlash, ClipboardText, Lightning, LightningSlash } from "@phosphor-icons/react";
import { services } from "@/services";
import { CardError, type FamilyCard, type FamilyMember } from "@/services/types";
import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";
import { TopBar } from "@/components/screen/TopBar";
import { getMemberByDeviceId } from "@/store/family";
import { toast } from "@/app/ui";
import { useReduced } from "@/app/session";
import { haptic } from "@/design/haptics";
import { ease, spring } from "@/design/motion";
import { centre } from "@/design/origin";
import { cn } from "@/lib/cn";

type Phase = "starting" | "scanning" | "denied" | "nocamera" | "found";

const FRAME = 248;

export function Scan() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const lastBad = useRef<{ data: string; at: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [shake, setShake] = useState(0);
  const [already, setAlready] = useState<FamilyMember | null>(null);
  const [snap, setSnap] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const accept = useCallback(
    async (data: string, corners?: QrScanner.Point[]) => {
      let card: FamilyCard;
      try {
        card = services.card.fromLink(data);
      } catch (e) {
        const now = Date.now();
        if (lastBad.current && lastBad.current.data === data && now - lastBad.current.at < 3000) return false;
        lastBad.current = { data, at: now };
        haptic("error");
        setShake((s) => s + 1);
        const code = e instanceof CardError ? e.code : "not_pehchaan";
        toast(code === "own_card" ? t("scan.own") : code === "corrupt" ? t("scan.corrupt") : t("scan.notPehchaan"), {
          tone: "error",
        });
        return false;
      }
      const existing = await getMemberByDeviceId(card.deviceId);
      if (existing) {
        scannerRef.current?.stop();
        setAlready(existing);
        return true;
      }
      // Success: snap the brackets to the code, burst a check, then move on.
      scannerRef.current?.stop();
      haptic("success");
      const origin = centre();
      const video = videoRef.current;
      const box = boxRef.current?.getBoundingClientRect();
      if (corners && video && box && video.videoWidth) {
        const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
        const ox = (box.width - video.videoWidth * scale) / 2;
        const oy = (box.height - video.videoHeight * scale) / 2;
        const xs = corners.map((p) => p.x * scale + ox);
        const ys = corners.map((p) => p.y * scale + oy);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const w = Math.max(...xs) - x;
        const h = Math.max(...ys) - y;
        setSnap({ x, y, w, h });
        origin.x = box.left + x + w / 2;
        origin.y = box.top + y + h / 2;
      }
      setPhase("found");
      window.setTimeout(
        () => navigate("/family/confirm", { replace: true, state: { card, origin } }),
        reduced ? 150 : 650,
      );
      return true;
    },
    [navigate, reduced, t],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    (async () => {
      if (!(await QrScanner.hasCamera())) {
        if (!cancelled) setPhase("nocamera");
        return;
      }
      const scanner = new QrScanner(video, (r) => void accept(r.data, r.cornerPoints), {
        returnDetailedScanResult: true,
        preferredCamera: "environment",
        maxScansPerSecond: 10,
        highlightScanRegion: false,
        highlightCodeOutline: false,
      });
      scannerRef.current = scanner;
      try {
        await scanner.start();
        if (cancelled) return;
        setPhase("scanning");
        setHasTorch(await scanner.hasFlash());
      } catch {
        if (!cancelled) setPhase("denied");
      }
    })();
    return () => {
      cancelled = true;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, [accept]);

  const cameraBlocked = phase === "denied" || phase === "nocamera";

  return (
    <div className="relative min-h-app bg-[#05070F] text-white">
      <div ref={boxRef} className="absolute inset-0 overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-hidden />
        {/* Dim everything outside the scan window. */}
        {!cameraBlocked && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(circle at 50% 44%, transparent ${FRAME * 0.62}px, rgba(5,7,15,0.62) ${FRAME * 0.64}px)`,
            }}
          />
        )}
      </div>

      <div className="relative z-10">
        <TopBar title={t("scan.title")} titleAlways tone="onDark" />
      </div>

      {!cameraBlocked && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <m.div
            key={shake}
            className="absolute left-1/2 top-[44%]"
            style={{ width: FRAME, height: FRAME, marginLeft: -FRAME / 2, marginTop: -FRAME / 2 }}
            animate={
              snap && boxRef.current
                ? {
                    x: snap.x + snap.w / 2 - boxRef.current.clientWidth / 2,
                    y: snap.y + snap.h / 2 - boxRef.current.clientHeight * 0.44,
                    scale: Math.max(0.35, Math.min(1.4, Math.max(snap.w, snap.h) / FRAME + 0.08)),
                  }
                : shake && !reduced
                  ? { x: [0, -10, 10, -6, 6, 0] }
                  : { x: 0 }
            }
            transition={snap ? spring.ui : { duration: 0.36 }}
          >
            <div
              className="absolute inset-0"
              style={{
                animation: phase === "scanning" && !reduced ? "brackets-breathe 2.4s ease-in-out infinite" : undefined,
              }}
            >
              {(["tl", "tr", "bl", "br"] as const).map((c) => (
                <span
                  key={c}
                  className={cn(
                    "absolute h-12 w-12 border-white",
                    c === "tl" && "left-0 top-0 rounded-tl-[22px] border-l-[4px] border-t-[4px]",
                    c === "tr" && "right-0 top-0 rounded-tr-[22px] border-r-[4px] border-t-[4px]",
                    c === "bl" && "bottom-0 left-0 rounded-bl-[22px] border-b-[4px] border-l-[4px]",
                    c === "br" && "bottom-0 right-0 rounded-br-[22px] border-b-[4px] border-r-[4px]",
                    phase === "found" && "border-[#B3B9FF]",
                  )}
                />
              ))}
            </div>
            {phase === "scanning" && !reduced && (
              <span
                className="absolute inset-x-4 top-3 h-0.5 rounded-full"
                style={{
                  background: "linear-gradient(90deg, transparent, #B3B9FF, transparent)",
                  boxShadow: "0 0 18px 4px rgba(140,149,255,0.45)",
                  animation: "scan-line 2.2s cubic-bezier(0.65,0,0.35,1) infinite",
                  ["--scan-travel" as string]: `${FRAME - 24}px`,
                }}
              />
            )}
            <AnimatePresence>
              {phase === "found" && (
                <m.span
                  className="absolute inset-0 grid place-items-center"
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={spring.stamp}
                >
                  <span className="grid h-20 w-20 place-items-center rounded-full bg-[#3A45D6] shadow-[0_0_0_10px_rgba(58,69,214,0.25)]">
                    <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden>
                      <m.path
                        d="M11 21 L17.5 27 L29.5 14"
                        fill="none"
                        stroke="#fff"
                        strokeWidth={4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.3, delay: 0.1, ease: ease.out }}
                      />
                    </svg>
                  </span>
                </m.span>
              )}
            </AnimatePresence>
          </m.div>
        </div>
      )}

      {/* Bottom controls */}
      <div
        className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-[480px] px-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
      >
        {cameraBlocked ? (
          <div
            className="mb-4 rounded-[24px] bg-white/[0.08] p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
            role="alert"
          >
            <CameraSlash size={32} weight="duotone" className="text-[#B3B9FF]" aria-hidden />
            <p className="mt-3 text-body font-medium">
              {phase === "denied" ? t("scan.cameraOff") : t("scan.noCamera")}
            </p>
          </div>
        ) : (
          <p className="mb-4 text-center text-body font-medium text-white/90" aria-live="polite">
            {phase === "starting" ? t("scan.starting") : phase === "found" ? t("scan.found") : t("scan.instruction")}
          </p>
        )}

        <AnimatePresence>
          {already && (
            <m.div
              className="mb-3 rounded-[20px] bg-white p-4 text-[#0F1430]"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="alert"
            >
              <p className="text-body font-semibold">{t("scan.already", { name: already.label })}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    setAlready(null);
                    void scannerRef.current?.start();
                  }}
                >
                  {t("confirm.scanAgain")}
                </Button>
                <Button size="md" onClick={() => navigate(`/family/${already.id}`, { replace: true })}>
                  {t("common.open")}
                </Button>
              </div>
            </m.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2.5">
          {hasTorch && (
            <Button
              variant="on-verdict-ghost"
              size="lg"
              aria-pressed={torchOn}
              aria-label={t("scan.torch")}
              icon={torchOn ? <LightningSlash size={22} /> : <Lightning size={22} weight="fill" />}
              onClick={async () => {
                await scannerRef.current?.toggleFlash();
                setTorchOn((v) => !v);
              }}
            />
          )}
          <Button
            variant={cameraBlocked ? "on-verdict" : "on-verdict-ghost"}
            full
            icon={<ClipboardText size={22} />}
            onClick={() => setPasteOpen(true)}
          >
            {t("scan.paste")}
          </Button>
        </div>
      </div>

      <Sheet open={pasteOpen} onClose={() => setPasteOpen(false)} labelledBy="paste-title">
        <h2 id="paste-title" className="font-display text-h2 font-semibold">
          {t("scan.pasteTitle")}
        </h2>
        <p className="mt-1 text-body-sm text-ink-2">{t("scan.pasteHint")}</p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={t("scan.pastePlaceholder")}
          rows={4}
          aria-label={t("scan.pasteTitle")}
          className="mt-4 w-full resize-none rounded-[12px] bg-surface-2 p-4 font-mono text-body-sm text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--brand)]"
        />
        <Button
          className="mt-4"
          full
          disabled={!pasteText.trim()}
          onClick={async () => {
            if (await accept(pasteText.trim())) setPasteOpen(false);
          }}
        >
          {t("scan.pasteCta")}
        </Button>
      </Sheet>
    </div>
  );
}
