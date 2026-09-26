// What Diagnostics may offer in which build (backend spec 10.9, FC-20).
import type { appConfig } from "@/app/config";

/** "Reset used request numbers" only weakens replay protection, so production never shows it (10.9). */
export const mayResetUsedNonces = (env: (typeof appConfig)["env"]): boolean => env !== "production";
