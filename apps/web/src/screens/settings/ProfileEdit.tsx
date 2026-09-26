// I1a · Profile (spec B12 I1a): edit name, phone, colour and Hindi form.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Info } from "@phosphor-icons/react";
import { Button } from "@/components/Button";
import { BottomActions, PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { ProfileForm, validateDraft, type ProfileDraft } from "@/screens/setup/NameStep";
import { setPrefs, updateProfile, useProfile } from "@/store/profile";
import { toast } from "@/app/ui";
import { haptic } from "@/design/haptics";
import { PageSkeleton } from "@/components/Skeleton";

export function ProfileEdit() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const profile = useProfile();
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [errors, setErrors] = useState<{ name?: string | null; phone?: string | null }>({});

  useEffect(() => {
    if (profile && !draft) {
      setDraft({
        name: profile.name,
        phone: profile.phone?.replace(/^\+91\s?/, "") ?? "",
        color: profile.color,
        hindiForm: profile.hindiForm,
      });
    }
  }, [profile, draft]);

  if (!draft) return <PageSkeleton />;

  return (
    <>
      <TopBar title={t("profileEdit.title")} />
      <PageBody>
        <PageTitle>{t("profileEdit.title")}</PageTitle>
        <ProfileForm draft={draft} setDraft={setDraft} errors={errors} />
        <p className="mt-6 flex items-start gap-2.5 rounded-[18px] bg-brand-soft p-4 text-body-sm text-ink">
          <Info size={20} className="mt-0.5 shrink-0 text-brand-ink" aria-hidden />
          {t("profileEdit.note")}
        </p>
        <BottomActions>
          <Button
            full
            onClick={async () => {
              const v = validateDraft(draft, t);
              setErrors(v.errors);
              if (!v.ok) {
                haptic("error");
                return;
              }
              await updateProfile({
                name: draft.name.trim(),
                phone: v.phone,
                color: draft.color,
                hindiForm: draft.hindiForm,
              });
              await setPrefs({ hindiForm: draft.hindiForm });
              toast(t("profileEdit.saved"), { tone: "success" });
              navigate(-1);
            }}
          >
            {t("common.save")}
          </Button>
        </BottomActions>
      </PageBody>
    </>
  );
}
