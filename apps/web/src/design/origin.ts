// Where the last tap happened, so full-screen takeovers can reveal from it (spec B6.2:
// "circular clip-path reveal from the origin point: the tapped button, or the screen centre").
//
// The family app runs inside the phone frame (#phone-root): the whole screen on phones, a
// 375 × 667 card on wider screens. Pointer positions are in viewport ("client") coordinates;
// `toFrame()` converts them into the frame's own coordinates.

export interface Point {
  x: number;
  y: number;
}

export const PHONE_ROOT_ID = "phone-root";

let last: (Point & { at: number }) | null = null;
let pinned: (Point & { at: number }) | null = null;

export function installOriginTracker() {
  window.addEventListener(
    "pointerdown",
    (e) => {
      last = { x: e.clientX, y: e.clientY, at: Date.now() };
    },
    { capture: true, passive: true },
  );
}

/** The phone frame's box in viewport coordinates (the viewport itself if there is no frame). */
export function frameRect(): { left: number; top: number; width: number; height: number } {
  const el = typeof document !== "undefined" ? document.getElementById(PHONE_ROOT_ID) : null;
  if (el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/** Where portals (sheets, full-screen overlays) mount, so they stay inside the phone frame. */
export function portalTarget(): HTMLElement {
  return document.getElementById(PHONE_ROOT_ID) ?? document.body;
}

/** Explicitly sets the next reveal origin (e.g. Maa's avatar on the waiting screen). */
export function pinOrigin(p: Point) {
  pinned = { ...p, at: Date.now() };
}

export function pinOriginFromElement(el: Element | null) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  pinOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

/** The centre of the phone frame, in viewport coordinates. */
export function centre(): Point {
  const r = frameRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Viewport coordinates → the phone frame's own coordinates. */
export function toFrame(p: Point): Point {
  const r = frameRect();
  return { x: p.x - r.left, y: p.y - r.top };
}

/** The pinned origin if fresh, else the last tap if fresh, else the frame centre (viewport coords). */
export function takeOrigin(maxAgeMs = 3000): Point {
  const now = Date.now();
  if (pinned && now - pinned.at < maxAgeMs) {
    const p = pinned;
    pinned = null;
    return { x: p.x, y: p.y };
  }
  if (last && now - last.at < maxAgeMs) return { x: last.x, y: last.y };
  return centre();
}

/** Radius that covers the whole phone frame from a point in frame coordinates. */
export function coverRadius(p: Point): number {
  const { width: w, height: h } = frameRect();
  return Math.ceil(Math.hypot(Math.max(p.x, w - p.x), Math.max(p.y, h - p.y))) + 4;
}
