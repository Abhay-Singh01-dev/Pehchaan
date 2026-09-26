// Motion's full DOM feature bundle, loaded after first paint (LazyMotion keeps the initial
// bundle small). domMax is needed over domAnimation for shared-element `layoutId`
// transitions and drag-to-dismiss sheets (spec B6.2).
import { domMax } from "motion/react";

export default domMax;
