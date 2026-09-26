// Call Guard → "+ Add a phone" (backend spec 13.2, FC-22): pair this laptop with a parent's phone by its family
// card. Scan the phone's My code QR with the laptop camera (the same scanner as C4), or paste its family link
// (the same parser as C8). The four safety words are shown to compare with the phone's own; only then is it saved.
import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { Camera, ClipboardText } from "@phosphor-icons/react";
import { services } from "@/services";
import { CardError, type FamilyCard } from "@/services/types";
import { Button } from "@/components/Button";
import { SafetyWords } from "@/components/SafetyWords";
import { addGuardTarget, type GuardTarget } from "@/store/guardTargets";
import { useG } from "@/app/i18n";

export function AddPhone({ onDone, onCancel }: { onDone: (t: GuardTarget) => void; onCancel: () => void }) {
  const { t } = useG();
  const [text, setText] = useState("");
  const [card, setCard] = useState<FamilyCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const read = async (data: string) => {
    setError(null);
    try {
      setCard(await services.card.fromLink(data));
      setScanning(false);
    } catch (e) {
      setError(e instanceof CardError && e.code === "own_card" ? t("guardPair.own") : t("guardPair.unreadable"));
    }
  };

  useEffect(() => {
    if (!scanning || !video.current) return;
    const scanner = new QrScanner(video.current, (r) => void read(r.data), { returnDetailedScanResult: true });
    scanner.start().catch(() => {
      setScanning(false);
      setError(t("guardPair.noCamera"));
    });
    return () => scanner.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  return (
    <div className="card p-5" role="dialog" aria-labelledby="guard-add">
      <h2 id="guard-add" className="font-display text-h3 font-semibold text-ink">
        {t("guardPair.title")}
      </h2>
      {!card ? (
        <>
          <p className="mt-1 text-body-sm text-ink-2">{t("guardPair.body")}</p>
          {scanning ? (
            <video ref={video} className="mt-3 aspect-video w-full rounded-[14px] bg-black object-cover" muted />
          ) : (
            <Button
              className="mt-3"
              size="md"
              variant="secondary"
              icon={<Camera size={18} />}
              onClick={() => setScanning(true)}
            >
              {t("guardPair.scan")}
            </Button>
          )}
          <label className="mt-4 block text-body-sm font-medium text-ink" htmlFor="guard-link">
            {t("guardPair.paste")}
          </label>
          <textarea
            id="guard-link"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="mt-1.5 w-full rounded-[14px] bg-surface-2 p-3 font-mono text-caption text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none"
          />
          {error && (
            <p role="alert" className="mt-2 text-body-sm text-chip-no">
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              size="md"
              icon={<ClipboardText size={18} />}
              disabled={!text.trim()}
              onClick={() => void read(text.trim())}
            >
              {t("guardPair.read")}
            </Button>
            <Button size="md" variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-body text-ink">{t("guardPair.compare", { name: card.name })}</p>
          <SafetyWords className="mt-3" words={card.safetyWords} />
          <div className="mt-4 flex gap-2">
            <Button size="md" onClick={async () => onDone(await addGuardTarget(card))}>
              {t("guardPair.match")}
            </Button>
            <Button size="md" variant="ghost" onClick={onCancel}>
              {t("guardPair.noMatch")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
