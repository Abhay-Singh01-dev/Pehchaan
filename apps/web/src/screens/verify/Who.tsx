// D1 · Who does the caller say they are? (spec B12 D1). The Verify button's colour floods out
// from the tap to open this screen (B6.4 #6). Never auto-fills a person from a call (B9 #7).
//   - a 2-column grid of members who can be verified, most recently checked first
//   - "Someone else" → E5 Can't verify (no network call)
//   - "Police, bank or government" → D4
//   - offline: an amber banner; tiles stay tappable (the flow ends in E3 "offline")
import { useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { CaretRight, Plus, UserCircleDashed, Siren, WifiSlash } from "@phosphor-icons/react";
import { MemberTile } from "@/components/Member";
import { Button } from "@/components/Button";
import { PageBody, PageTitle } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { useFamily } from "@/store/family";
import { useConnection, useReachable, useReduced } from "@/app/session";
import { recordUnknownPerson } from "@/app/verification";
import { riseIn } from "@/design/motion";

function WideTile({
  icon,
  title,
  hint,
  onClick,
  index,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
  index: number;
}) {
  const reduced = useReduced();
  return (
    <m.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      {...riseIn(index, reduced, 0.06)}
      className="card flex min-h-[76px] w-full items-center gap-4 px-4 py-3 text-left active:bg-surface-2"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-h3 font-semibold text-ink">{title}</span>
        <span className="block text-body-sm text-muted">{hint}</span>
      </span>
      <CaretRight size={20} className="shrink-0 text-muted" aria-hidden />
    </m.button>
  );
}

export function Who() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const family = useFamily();
  const reachable = useReachable();
  const connection = useConnection();
  const reduced = useReduced();
  const amountInr = (location.state as { amountInr?: number } | null)?.amountInr;

  const members = useMemo(
    () =>
      (family ?? [])
        .filter((m) => m.canBeVerified)
        .sort((a, b) => (b.lastCheckedAt ?? 0) - (a.lastCheckedAt ?? 0) || a.addedAt - b.addedAt),
    [family],
  );

  return (
    <>
      <TopBar title={t("verify.who")} />
      <PageBody>
        {connection === "offline" && (
          <m.div
            role="alert"
            className="mb-5 flex items-start gap-3 rounded-[18px] p-4 text-[#1F1300]"
            style={{ background: "linear-gradient(180deg, #FDB022, #F79009)" }}
            initial={{ opacity: 0, y: reduced ? 0 : -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <WifiSlash size={24} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
            <p className="text-body font-semibold">{t("verify.offline")}</p>
          </m.div>
        )}
        <PageTitle>{t("verify.who")}</PageTitle>

        {family && members.length === 0 ? (
          <m.div className="card p-5" {...riseIn(1, reduced)}>
            <p className="text-body text-ink-2">{t("verify.noMembers")}</p>
            <Button
              className="mt-4"
              full
              icon={<Plus size={20} weight="bold" />}
              onClick={() => navigate("/family/add")}
            >
              {t("verify.addFamily")}
            </Button>
          </m.div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {members.map((mem, i) => (
              <MemberTile
                key={mem.id}
                member={mem}
                index={i + 1}
                reachable={reachable.includes(mem.deviceId)}
                onClick={() => navigate("/verify/what", { state: { memberId: mem.id, amountInr } })}
              />
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-col gap-3">
          <WideTile
            index={members.length + 1}
            icon={<UserCircleDashed size={26} weight="duotone" />}
            title={t("verify.someone")}
            hint={t("verify.someoneHint")}
            onClick={async () => {
              const id = await recordUnknownPerson();
              navigate(`/verify/result/${id}`, { replace: true });
            }}
          />
          <WideTile
            index={members.length + 2}
            icon={<Siren size={26} weight="duotone" />}
            title={t("verify.official")}
            hint={t("verify.officialHint")}
            onClick={() => navigate("/verify/official")}
          />
        </div>
      </PageBody>
    </>
  );
}
