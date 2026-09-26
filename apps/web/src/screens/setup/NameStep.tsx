// A4 · Your name (spec B12 A4). Also reused by I1a (Settings → Profile) via ProfileForm.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import type { AvatarColor, HindiForm, Profile } from "@/services/types";
import { safetyWordsFor } from "@/services/words";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { ChipGroup, TextField } from "@/components/controls";
import { BottomActions, PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { getPrefs, saveProfile, setPrefs, updateProfile, useProfile } from "@/store/profile";
import { normalizeIndianMobile, initials } from "@/lib/format";
import { useRecordSetupStep } from "@/app/startRoute";
import { useSession, useReduced } from "@/app/session";
import { dur, riseIn, spring } from "@/design/motion";
import { haptic } from "@/design/haptics";
import { cn } from "@/lib/cn";

const COLORS: AvatarColor[] = ["indigo", "teal", "saffron", "rose", "plum", "slate"];

export interface ProfileDraft {
  name: string;
  phone: string;
  color: AvatarColor;
  hindiForm: HindiForm;
}

export function ProfileForm({
  draft,
  setDraft,
  errors,
}: {
  draft: ProfileDraft;
  setDraft: (d: ProfileDraft) => void;
  errors: { name?: string | null; phone?: string | null };
}) {
  const { t, i18n } = useTranslation();
  const reduced = useReduced();
  const inHindi = i18n.language === "hi";
  const shown = draft.name.trim() || "?";

  return (
    <div className="flex flex-col gap-6">
      <m.div className="flex items-center gap-4" {...riseIn(1, reduced)}>
        <div className="relative">
          <AnimatePresence mode="popLayout" initial={false}>
            <m.div
              key={`${initials(shown)}-${draft.color}`}
              initial={{ opacity: 0, scale: reduced ? 1 : 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: dur.base }}
            >
              <Avatar name={shown} color={draft.color} size={72} />
            </m.div>
          </AnimatePresence>
        </div>
        <div className="min-w-0">
          <div className="text-caption font-medium uppercase tracking-[0.06em] text-muted">{t("name.preview")}</div>
          <div className="truncate font-display text-h2 font-semibold text-ink">{draft.name.trim() || "—"}</div>
        </div>
      </m.div>

      <m.div {...riseIn(2, reduced)}>
        <TextField
          label={t("name.label")}
          value={draft.name}
          onChange={(v) => setDraft({ ...draft, name: v.slice(0, 30) })}
          placeholder={t("name.placeholder")}
          autoFocus
          maxLength={30}
          autoComplete="name"
          error={errors.name}
        />
      </m.div>

      <m.div {...riseIn(3, reduced)}>
        <TextField
          label={t("name.phone")}
          value={draft.phone}
          onChange={(v) => setDraft({ ...draft, phone: v.replace(/[^\d ]/g, "").slice(0, 12) })}
          prefix="+91"
          inputMode="tel"
          autoComplete="tel-national"
          hint={t("name.phoneHint")}
          error={errors.phone}
        />
      </m.div>

      <m.div {...riseIn(4, reduced)}>
        <div className="mb-3 text-body-sm font-medium text-ink-2">{t("name.color")}</div>
        <div role="radiogroup" aria-label={t("name.color")} className="flex flex-wrap gap-3">
          {COLORS.map((c) => {
            const selected = draft.color === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t(`color.${c}`)}
                onClick={() => {
                  haptic("chip");
                  setDraft({ ...draft, color: c });
                }}
                className="relative grid h-12 w-12 place-items-center rounded-full"
              >
                {selected && (
                  <m.span
                    layoutId="swatch-ring"
                    className="absolute inset-0 rounded-full shadow-[inset_0_0_0_2.5px_var(--brand)]"
                    transition={spring.ui}
                  />
                )}
                <span
                  className="h-9 w-9 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
                  style={{ background: `var(--av-${c})` }}
                />
              </button>
            );
          })}
        </div>
      </m.div>

      <m.div {...riseIn(5, reduced)} className={cn(!inHindi && "rounded-[18px] bg-surface-2 p-4")}>
        <div className={cn("mb-1 font-medium text-ink-2", inHindi ? "text-body-sm" : "text-body-sm")}>
          {t("name.hindiForm")}
        </div>
        <p className="mb-3 text-caption text-muted">{t("name.hindiFormHint")}</p>
        <ChipGroup
          label={t("name.hindiForm")}
          size={inHindi ? "md" : "sm"}
          value={draft.hindiForm}
          onChange={(v) => setDraft({ ...draft, hindiForm: v })}
          options={(["m", "f", "n"] as const).map((v) => ({
            value: v,
            label: inHindi
              ? t(`name.form.${v}`)
              : `${t(`name.form.${v}`)} · ${{ m: "पुरुष", f: "महिला", n: "बताना नहीं" }[v]}`,
          }))}
        />
      </m.div>
    </div>
  );
}

export function validateDraft(draft: ProfileDraft, t: (k: string) => string) {
  const errors: { name?: string | null; phone?: string | null } = {};
  if (!draft.name.trim()) errors.name = t("name.errEmpty");
  let phone: string | undefined;
  if (draft.phone.trim()) {
    const n = normalizeIndianMobile(draft.phone);
    if (!n) errors.phone = t("name.errPhone");
    else phone = n;
  }
  return { errors, phone, ok: !errors.name && !errors.phone };
}

export function NameStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  const deviceId = useSession((s) => s.deviceId);
  const [draft, setDraft] = useState<ProfileDraft>({ name: "", phone: "", color: "indigo", hindiForm: "n" });
  const [errors, setErrors] = useState<{ name?: string | null; phone?: string | null }>({});
  const [busy, setBusy] = useState(false);
  useRecordSetupStep();

  // Coming back to this step: prefill from what was saved.
  useEffect(() => {
    if (profile) {
      setDraft({
        name: profile.name,
        phone: profile.phone?.replace(/^\+91\s?/, "") ?? "",
        color: profile.color,
        hindiForm: profile.hindiForm,
      });
    } else if (profile === null) {
      void getPrefs().then((p) => setDraft((d) => ({ ...d, hindiForm: p.hindiForm })));
    }
  }, [profile]);

  const submit = async () => {
    const v = validateDraft(draft, t);
    setErrors(v.errors);
    if (!v.ok || !deviceId) {
      haptic("error");
      return;
    }
    setBusy(true);
    const name = draft.name.trim();
    if (profile) {
      await updateProfile({ name, phone: v.phone, color: draft.color, hindiForm: draft.hindiForm });
    } else {
      const prefs = await getPrefs();
      const next: Profile = {
        deviceId,
        name,
        color: draft.color,
        role: "checks_only",
        // Checks-only people still have safety words, so family can confirm their card in person.
        safetyWords: await safetyWordsFor(`checks-only:${deviceId}`),
        ...prefs,
        hindiForm: draft.hindiForm,
        createdAt: Date.now(),
        setupComplete: false,
      };
      if (v.phone) next.phone = v.phone;
      await saveProfile(next);
    }
    await setPrefs({ hindiForm: draft.hindiForm });
    navigate("/setup/role");
  };

  return (
    <>
      <TopBar title={t("name.title")} backTo="/setup/welcome" />
      <PageBody>
        <PageTitle sub={t("name.hint")}>{t("name.title")}</PageTitle>
        <ProfileForm draft={draft} setDraft={setDraft} errors={errors} />
        <BottomActions>
          <Button full onClick={submit} loading={busy}>
            {t("common.continue")}
          </Button>
        </BottomActions>
      </PageBody>
    </>
  );
}
