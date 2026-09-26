// C1 · Family list (spec B12 C1): h1 "Family" with a count; sections "Can be verified" and
// "Checks only"; rows stagger in; tapping a row morphs its avatar into C6's header.
import { useNavigate } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { MemberRow } from "@/components/Member";
import { FamilyIllustration } from "@/components/illustrations";
import { PageBody } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useFamily } from "@/store/family";
import { useReachable, useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";

export function FamilyList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const family = useFamily();
  const reachable = useReachable();
  const reduced = useReduced();
  const verifiable = family?.filter((m) => m.canBeVerified) ?? [];
  const checksOnly = family?.filter((m) => !m.canBeVerified) ?? [];

  return (
    <>
      <TopBar
        hideBack
        title={t("family.title")}
        right={
          <m.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={() => navigate("/family/add")}
            aria-label={t("family.add")}
            className="grid h-12 w-12 place-items-center rounded-full text-brand-ink active:bg-brand-soft"
          >
            <Plus size={24} weight="bold" />
          </m.button>
        }
      />
      <PageBody withTabBar>
        <m.div className="mb-6 flex items-end justify-between gap-3" {...riseIn(0, reduced)}>
          <h1 className="font-display text-h1 font-semibold text-ink">{t("family.title")}</h1>
          {family && family.length > 0 && (
            <span className="mb-1 text-body-sm text-muted">{t("family.count", { count: family.length })}</span>
          )}
        </m.div>

        {family && family.length === 0 ? (
          <EmptyState
            illustration={<FamilyIllustration />}
            text={t("family.empty")}
            action={
              <Button full onClick={() => navigate("/family/add")} icon={<Plus size={20} weight="bold" />}>
                {t("family.emptyCta")}
              </Button>
            }
          />
        ) : (
          <>
            {[
              { key: "family.canBeVerified", list: verifiable, offset: 1 },
              { key: "family.checksOnly", list: checksOnly, offset: 1 + verifiable.length },
            ]
              .filter((s) => s.list.length > 0)
              .map((s) => (
                <section key={s.key} className="mb-6">
                  <h2 className="mb-2 px-1 text-caption font-medium uppercase tracking-[0.06em] text-muted">
                    {t(s.key)}
                  </h2>
                  <div className="card divide-y divide-line overflow-hidden">
                    {s.list.map((mem, i) => (
                      <MemberRow
                        key={mem.id}
                        member={mem}
                        index={s.offset + i}
                        reachable={reachable.includes(mem.deviceId)}
                        onClick={() => navigate(`/family/${mem.id}`)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            <Button full onClick={() => navigate("/family/add")} icon={<Plus size={20} weight="bold" />}>
              {t("family.add")}
            </Button>
          </>
        )}
      </PageBody>
    </>
  );
}
