// A5 · Could someone pretend to be you? (spec B12 A5). Nothing is preselected; Continue stays
// disabled until a choice. Yes → A6 (create key). No → A7 with role checks_only.
import { useState } from "react";
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Eye, Key } from "@phosphor-icons/react";
import { Button } from "@/components/Button";
import { SelectCard } from "@/components/controls";
import { BottomActions, PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { updateProfile } from "@/store/profile";
import { useRecordSetupStep } from "@/app/startRoute";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";

export function RoleStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduced = useReduced();
  const [choice, setChoice] = useState<"yes" | "no" | null>(null);
  useRecordSetupStep();

  const next = async () => {
    if (choice === "yes") {
      navigate("/setup/key");
    } else if (choice === "no") {
      await updateProfile({ role: "checks_only" });
      navigate("/setup/done");
    }
  };

  return (
    <>
      <TopBar title={t("role.title")} />
      <PageBody>
        <PageTitle sub={t("role.lead")}>{t("role.title")}</PageTitle>
        <div role="radiogroup" aria-label={t("role.title")} className="flex flex-col gap-3">
          <m.div {...riseIn(1, reduced)}>
            <SelectCard
              selected={choice === "yes"}
              onClick={() => setChoice("yes")}
              icon={<Key size={30} weight="duotone" />}
              title={t("role.yes")}
              hint={t("role.yesHint")}
            />
          </m.div>
          <m.div {...riseIn(2, reduced)}>
            <SelectCard
              selected={choice === "no"}
              onClick={() => setChoice("no")}
              icon={<Eye size={30} weight="duotone" />}
              title={t("role.no")}
              hint={t("role.noHint")}
            />
          </m.div>
        </div>
        <BottomActions>
          <Button full disabled={!choice} onClick={next}>
            {t("common.continue")}
          </Button>
        </BottomActions>
      </PageBody>
    </>
  );
}
