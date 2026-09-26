// Route transition rules (spec B6.2).
//   forward   new screen enters from x: 28, old exits to x: -12
//   back      the mirror image
//   tab       crossfade only
//   reveal    circular clip-path reveal from the tapped point (waiting screen, verdicts)
//   brand     Home → "Who is calling": the Verify button's colour floods out from the tap
//   takeover  incoming request: reveal from the screen centre over a blurred backdrop
//   fade      leaving a takeover or verdict screen
import { isTabRoute } from "@/components/TabBar";

export type TransitionKind = "forward" | "back" | "tab" | "reveal" | "brand" | "takeover" | "fade" | "none";

const TAKEOVER_SCREENS = [/^\/request\/[^/]+$/, /^\/request\/[^/]+\/sent$/, /^\/verify\/result\//, /^\/verify\/waiting\//];

export const isTakeoverScreen = (path: string) => TAKEOVER_SCREENS.some((re) => re.test(path));

export function transitionFor(from: string | null, to: string, direction: "forward" | "back"): TransitionKind {
  if (from === null) return "none";
  if (from === to) return "none";
  if (from === "/") return "fade";
  if (/^\/request\/[^/]+$/.test(to)) return "takeover";
  if (/^\/request\/[^/]+\/sent$/.test(to)) return "fade";
  if (/^\/verify\/(waiting|result)\//.test(to)) return "reveal";
  if (to === "/verify/who" && from === "/home") return "brand";
  if (isTakeoverScreen(from)) return "fade";
  if (isTabRoute(from) && isTabRoute(to)) return "tab";
  return direction;
}
