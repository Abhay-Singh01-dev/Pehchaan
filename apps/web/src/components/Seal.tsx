// The seal: Pehchaan's brand mark and the centre of every verdict (spec B5.5).
//   - outer ring: 2px solid brass (with fine engraved reeding at large sizes)
//   - inner ring: 1px dashed neel (4 dash, 3 gap)
//   - the Devanagari letter "प", or a drawn icon for verdict states
// On verdict colours (`tone="light"` / `tone="dark"`) the rings turn white (or deep amber-ink).
import { useId, type CSSProperties } from "react";
import * as m from "motion/react-m";
import { PA_GLYPH_PATH } from "@/design/glyphs";
import { ease } from "@/design/motion";
import { useReduced } from "@/app/session";

export type SealState = "brand" | "confirmed" | "denied" | "fake" | "waiting" | "unknown" | "clock" | "warning";
export type SealTone = "brand" | "light" | "dark" | "amber";

interface SealProps {
  size?: number;
  state?: SealState;
  tone?: SealTone;
  /** Animate the icon/letter drawing in. */
  draw?: boolean;
  /** Seconds before the draw starts. */
  drawDelay?: number;
  /** Splash: the outer ring draws clockwise and the inner ring fades in rotating 20°. */
  intro?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Draw everything in one colour (the Fake-answer glitch channels). */
  mono?: string;
}

const ICON_STROKE = 7;

function palette(tone: SealTone) {
  if (tone === "light") return { ring: "#FFFFFF", inner: "rgba(255,255,255,0.62)", fill: "#FFFFFF", tick: "rgba(255,255,255,0.35)" };
  if (tone === "dark") return { ring: "#1F1300", inner: "rgba(31,19,0,0.55)", fill: "#1F1300", tick: "rgba(31,19,0,0.3)" };
  if (tone === "amber") return { ring: "var(--brass)", inner: "var(--amber)", fill: "var(--chip-amber)", tick: "var(--brass)" };
  return { ring: "var(--brass)", inner: "var(--brand)", fill: "var(--brand)", tick: "var(--brass)" };
}

export function Seal({
  size = 40,
  state = "brand",
  tone = "brand",
  draw = false,
  drawDelay = 0,
  intro = false,
  className,
  style,
  title,
  mono,
}: SealProps) {
  const reduced = useReduced();
  const uid = useId().replace(/:/g, "");
  const c = mono ? { ring: mono, inner: mono, fill: mono, tick: mono } : palette(tone);
  const px = 100 / size; // one screen pixel in viewBox units
  const detailed = size >= 72;
  const animateDraw = draw && !reduced;
  const drawT = { duration: 0.3, ease: ease.out, delay: drawDelay };

  const drawProps = (delay = 0) =>
    animateDraw
      ? {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: { ...drawT, delay: drawDelay + delay, opacity: { duration: 0.01, delay: drawDelay + delay } },
        }
      : {};

  const stroke = {
    fill: "none",
    stroke: tone === "brand" && !mono ? "var(--brand)" : c.fill,
    strokeWidth: ICON_STROKE,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={{ overflow: "visible", ...style }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {detailed && tone === "brand" && (
        <>
          <defs>
            <radialGradient id={`sealfill-${uid}`} cx="50%" cy="38%" r="60%">
              <stop offset="0%" stopColor="var(--brand-soft)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="var(--brand-soft)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="45" fill={`url(#sealfill-${uid})`} />
        </>
      )}

      {/* Outer ring (+ reeding). Rotates clockwise while waiting. */}
      <g
        style={
          state === "waiting" && !reduced
            ? { transformOrigin: "50px 50px", animation: "spin-slow 14s linear infinite" }
            : undefined
        }
      >
        <m.circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={c.ring}
          strokeWidth={2 * px}
          style={{ rotate: -90, transformOrigin: "50px 50px" }}
          {...(intro && !reduced
            ? {
                initial: { pathLength: 0 },
                animate: { pathLength: 1 },
                transition: { duration: 0.5, ease: ease.inOut },
              }
            : {})}
        />
        {(detailed || state === "waiting") && (
          <g opacity={tone === "brand" ? 0.5 : 0.8}>
            {Array.from({ length: 72 }, (_, i) => {
              const a = (i / 72) * Math.PI * 2;
              const r1 = 41.6;
              const r2 = 43.6;
              return (
                <line
                  key={i}
                  x1={50 + Math.cos(a) * r1}
                  y1={50 + Math.sin(a) * r1}
                  x2={50 + Math.cos(a) * r2}
                  y2={50 + Math.sin(a) * r2}
                  stroke={c.tick}
                  strokeWidth={Math.max(0.45, 0.8 * px)}
                />
              );
            })}
          </g>
        )}
      </g>

      {/* Inner dashed ring. Rotates the other way while waiting. */}
      <g
        style={
          state === "waiting" && !reduced
            ? { transformOrigin: "50px 50px", animation: "spin-slow-rev 10s linear infinite" }
            : undefined
        }
      >
        <m.circle
          cx="50"
          cy="50"
          r="38.5"
          fill="none"
          stroke={c.inner}
          strokeWidth={1 * px}
          strokeDasharray={`${4 * px} ${3 * px}`}
          style={{ transformOrigin: "50px 50px" }}
          {...(intro && !reduced
            ? {
                initial: { opacity: 0, rotate: -20 },
                animate: { opacity: 1, rotate: 0 },
                transition: { duration: 0.45, delay: 0.25, ease: ease.out },
              }
            : {})}
        />
      </g>

      {/* Content */}
      {(state === "brand" || state === "waiting") && (
        <m.path
          d={PA_GLYPH_PATH}
          fill={tone === "brand" ? "var(--brand)" : c.fill}
          style={{ transformOrigin: "50px 50px" }}
          {...(intro && !reduced
            ? {
                initial: { opacity: 0, scale: 0.8 },
                animate: { opacity: 1, scale: 1 },
                transition: { duration: 0.35, delay: 0.45, ease: ease.out },
              }
            : animateDraw
              ? {
                  initial: { opacity: 0, scale: 0.85 },
                  animate: { opacity: 1, scale: 1 },
                  transition: { duration: 0.3, delay: drawDelay, ease: ease.out },
                }
              : {})}
        />
      )}

      {state === "confirmed" && <m.path d="M31 51.5 L44.5 64.5 L69.5 37.5" {...stroke} {...drawProps()} />}

      {state === "denied" && (
        <>
          <m.path d="M36 36 L64 64" {...stroke} {...drawProps()} />
          <m.path d="M64 36 L36 64" {...stroke} {...drawProps(0.12)} />
        </>
      )}

      {state === "fake" && (
        <>
          <m.path
            d="M50 26 L69 33.5 V49 C69 61.5 61 70.5 50 75 C39 70.5 31 61.5 31 49 V33.5 Z"
            {...stroke}
            strokeWidth={5}
            {...drawProps()}
          />
          <m.path d="M43.5 43.5 L56.5 56.5" {...stroke} strokeWidth={5.5} {...drawProps(0.16)} />
          <m.path d="M56.5 43.5 L43.5 56.5" {...stroke} strokeWidth={5.5} {...drawProps(0.22)} />
        </>
      )}

      {state === "clock" && (
        <>
          <m.circle cx="50" cy="50" r="22" {...stroke} strokeWidth={5} {...drawProps()} />
          <m.path d="M50 50 L50 39" {...stroke} strokeWidth={5} {...drawProps(0.1)} />
          <m.path
            d="M50 50 L61 50"
            {...stroke}
            strokeWidth={5}
            style={{ transformOrigin: "50px 50px" }}
            initial={animateDraw ? { rotate: -90, opacity: 0 } : undefined}
            animate={animateDraw ? { rotate: 270, opacity: 1 } : undefined}
            transition={animateDraw ? { rotate: { duration: 1.6, delay: drawDelay + 0.3, ease: ease.inOut }, opacity: { duration: 0.1, delay: drawDelay } } : undefined}
          />
        </>
      )}

      {state === "unknown" && (
        <>
          <m.path
            d="M40 41 C40 33 45 28.5 51 28.5 C57.5 28.5 62 33 62 38.5 C62 45.5 55.5 47.5 52.5 50.5 C50.5 52.5 50 54 50 58"
            {...stroke}
            strokeWidth={6.5}
            {...drawProps()}
          />
          <m.circle cx="50" cy="69" r="4.2" fill={stroke.stroke} {...drawProps(0.25)} />
        </>
      )}

      {state === "warning" && (
        <>
          <m.path d="M50 31 L50 56" {...stroke} {...drawProps()} />
          <m.circle cx="50" cy="68.5" r="4.4" fill={stroke.stroke} {...drawProps(0.2)} />
        </>
      )}
    </svg>
  );
}
