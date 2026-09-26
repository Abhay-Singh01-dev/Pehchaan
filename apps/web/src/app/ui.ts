// Transient UI: toasts (short confirmations) and top banners (family alerts, Call Guard prompts).
import { create } from "zustand";
import type { FamilyAlert, GuardPrompt } from "@/services/types";

export interface ToastItem {
  id: number;
  text: string;
  tone: "default" | "success" | "error";
  action?: { label: string; onClick: () => void };
  /** ms; 0 keeps it until dismissed. Default 3500 (spec B6.2). */
  duration: number;
}

export type BannerItem =
  { id: string; kind: "alert"; alert: FamilyAlert } | { id: string; kind: "guard"; prompt: GuardPrompt };

interface UiState {
  toasts: ToastItem[];
  banners: BannerItem[];
}

export const useUi = create<UiState>(() => ({ toasts: [], banners: [] }));

let toastSeq = 0;

export function toast(
  text: string,
  opts: { tone?: ToastItem["tone"]; action?: ToastItem["action"]; duration?: number } = {},
) {
  const item: ToastItem = {
    id: ++toastSeq,
    text,
    tone: opts.tone ?? "default",
    action: opts.action,
    duration: opts.duration ?? 3500,
  };
  // Keep at most two on screen; the newest is on top.
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-1), item] }));
  return item.id;
}

export function dismissToast(id: number) {
  useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function showBanner(b: BannerItem) {
  useUi.setState((s) => ({ banners: [b, ...s.banners.filter((x) => x.id !== b.id)].slice(0, 3) }));
}

export function dismissBanner(id: string) {
  useUi.setState((s) => ({ banners: s.banners.filter((b) => b.id !== id) }));
}
