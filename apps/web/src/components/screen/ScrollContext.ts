import { createContext, useContext } from "react";
import type { MotionValue } from "motion/react";

/** The current screen's scroll position, for the TopBar's fading title. */
export const ScrollContext = createContext<MotionValue<number> | null>(null);

export const useScreenScroll = () => useContext(ScrollContext);
