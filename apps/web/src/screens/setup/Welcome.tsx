// A3 · Welcome (spec B12 A3, B6.4 #2): three swipeable cards with an illustration, title and
// body; progress dots (the active one is a stretched pill); "Skip" top right; "Next" becomes
// "Get started" on card 3. On "Next" from card 1 the waveform morphs into the seal. Card
// changes use parallax: the illustration moves 1.5× the text.
import { useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, useMotionValue, useTransform, animate } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { BottomActions } from "@/components/screen/Page";
import { WaveformSeal } from "@/components/illustrations/WaveformSeal";
import { SplitSeal, TwoPhones } from "@/components/illustrations";
import { SIM_OFFSET } from "@/components/SimulationBadge";
import { useRecordSetupStep } from "@/app/startRoute";
import { useReduced } from "@/app/session";
import { dur, ease, spring } from "@/design/motion";
import { cn } from "@/lib/cn";

const CARDS = [1, 2, 3] as const;

export function Welcome() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [morph, setMorph] = useState(false);
  const dragX = useMotionValue(0);
  // The art sits inside the dragged container (which moves 1×), so +0.5× makes it 1.5×.
  const artX = useTransform(dragX, (x) => x * 0.5);
  useRecordSetupStep();

  const go = (next: number) => {
    if (next < 0 || next > 2 || next === index) return;
    setDir(next > index ? 1 : -1);
    setIndex(next);
  };

  const onNext = () => {
    if (index === 2) return navigate("/setup/name");
    if (index === 0 && !morph && !reduced) {
      // The bars collapse into the seal, then the card changes.
      setMorph(true);
      window.setTimeout(() => go(1), 950);
      return;
    }
    go(index + 1);
  };

  const n = CARDS[index]!;
  const slide = reduced ? 0 : 56;

  return (
    <div className="flex min-h-app flex-col" style={{ paddingTop: `calc(env(safe-area-inset-top) + ${SIM_OFFSET}px)` }}>
      <div className="flex h-14 items-center justify-end px-3">
        <Button variant="ghost" size="md" onClick={() => navigate("/setup/name")}>
          {t("welcome.skip")}
        </Button>
      </div>

      <m.div
        className="relative flex flex-1 touch-pan-y flex-col px-5"
        drag={reduced ? false : "x"}
        style={{ x: dragX }}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.32}
        onDragEnd={(_, info) => {
          if (info.offset.x < -60 || info.velocity.x < -500) onNext();
          else if (info.offset.x > 60 || info.velocity.x > 500) go(index - 1);
          void animate(dragX, 0, spring.soft);
        }}
        aria-roledescription="carousel"
      >
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <m.section
            key={n}
            custom={dir}
            className="flex flex-1 flex-col"
            aria-roledescription="slide"
            aria-label={t("welcome.slide", { n })}
          >
            {/* Parallax while dragging: the illustration moves 1.5× the text. */}
            <m.div className="flex min-h-[260px] flex-1 items-center justify-center" style={{ x: artX }}>
              <m.div
                initial={{ x: dir * slide * 1.5, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -dir * slide * 1.5, opacity: 0 }}
                transition={{ duration: dur.slow, ease: ease.out }}
              >
                {n === 1 && <WaveformSeal morph={morph} size={220} />}
                {n === 2 && <TwoPhones size={250} />}
                {n === 3 && <SplitSeal size={210} />}
              </m.div>
            </m.div>
            <m.div
              initial={{ x: dir * slide, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -dir * slide, opacity: 0 }}
              transition={{ duration: dur.slow, ease: ease.out }}
              className="pb-2"
            >
              <h1 className="font-display text-h1 font-semibold text-ink">{t(`welcome.${n}.title`)}</h1>
              <p className="mt-3 text-body text-ink-2">{t(`welcome.${n}.body`)}</p>
            </m.div>
          </m.section>
        </AnimatePresence>
      </m.div>

      <div className="px-5">
        <div className="mt-6 flex items-center gap-2" role="tablist" aria-label={t("welcome.progress")}>
          {CARDS.map((c, i) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={t("welcome.slide", { n: c })}
              onClick={() => go(i)}
              className="grid h-8 place-items-center"
            >
              <m.span
                className={cn("block h-2 rounded-full", i === index ? "bg-brand" : "bg-line")}
                animate={{ width: i === index ? 28 : 8 }}
                transition={spring.ui}
              />
            </button>
          ))}
        </div>
        <BottomActions className="mt-2">
          <Button full onClick={onNext}>
            {index === 2 ? t("welcome.start") : t("welcome.next")}
          </Button>
        </BottomActions>
      </div>
    </div>
  );
}
