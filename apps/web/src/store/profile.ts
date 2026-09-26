// The person using this phone, and their display preferences.
//
// Preferences (language, theme, text size, motion, sounds, Hindi form) are chosen before the
// profile exists (A2 picks the language first), so until then they live in `meta.prefs`.
// Once the profile is created they are copied into it, and the profile is the source of truth.
import { useLiveQuery } from "dexie-react-hooks";
import { db, type ProfileRow } from "./db";
import { getMeta, setMeta } from "./meta";
import type { HindiForm, Lang, Profile, TextSize, ThemePref } from "@/services/types";

export interface Prefs {
  lang: Lang;
  theme: ThemePref;
  textSize: TextSize;
  reduceMotion: boolean;
  soundsOn: boolean;
  hindiForm: HindiForm;
}

export const DEFAULT_PREFS: Prefs = {
  lang: "en",
  theme: "system",
  textSize: "normal",
  reduceMotion: false,
  soundsOn: true,
  hindiForm: "n",
};

const pickPrefs = (p: Profile): Prefs => ({
  lang: p.lang,
  theme: p.theme,
  textSize: p.textSize,
  reduceMotion: p.reduceMotion,
  soundsOn: p.soundsOn,
  hindiForm: p.hindiForm,
});

export async function getProfile(): Promise<Profile | null> {
  const row = await db.profile.get("me");
  if (!row) return null;
  const { id: _id, ...profile } = row;
  return profile;
}

export async function saveProfile(profile: Profile): Promise<void> {
  const row: ProfileRow = { ...profile, id: "me" };
  await db.profile.put(row);
}

export async function updateProfile(patch: Partial<Profile>): Promise<void> {
  await db.profile.update("me", patch);
}

export async function getPrefs(): Promise<Prefs> {
  const profile = await getProfile();
  if (profile) return pickPrefs(profile);
  const stored = await getMeta<Partial<Prefs>>("prefs");
  return { ...DEFAULT_PREFS, ...stored };
}

export async function setPrefs(patch: Partial<Prefs>): Promise<void> {
  const profile = await getProfile();
  if (profile) {
    await updateProfile(patch);
    return;
  }
  const stored = await getMeta<Partial<Prefs>>("prefs");
  await setMeta("prefs", { ...DEFAULT_PREFS, ...stored, ...patch });
}

/** `undefined` while loading, `null` when there is no profile yet. */
export function useProfile(): Profile | null | undefined {
  return useLiveQuery(getProfile, []);
}

export function usePrefs(): Prefs | undefined {
  return useLiveQuery(getPrefs, []);
}
