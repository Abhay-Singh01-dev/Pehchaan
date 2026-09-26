// E1–E5 · The verdict (spec B12 E), with E6 (Why? sheet) and E7 (say-the-words).
// Verdicts close only through their buttons (B9 #3): there is no swipe or tap-outside, and the
// back gesture asks "Close this result?" in-page. Only VerifierService can produce green (B9 #1).
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useBlocker, useNavigate, useParams } from "react-router";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import {
  ArrowClockwise,
  ChatCircleText,
  CheckCircle,
  Info,
  PhoneCall,
  Prohibit,
  PhoneSlash,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/Button";
import { InlineConfirm } from "@/components/InlineConfirm";
import { PhoneNumber } from "@/components/PhoneNumber";
import { Sheet } from "@/components/Sheet";
import { WhySheet } from "@/components/ChecksList";
import { VerdictAction, VerdictScreen, safeVerdict, VERDICT_TONE } from "@/components/VerdictScreen";
import { useOutgoing } from "@/store/requests";
import { useMember } from "@/store/family";
import { askFamilyToReach, checkAgain } from "@/app/verification";
import { useG } from "@/app/i18n";
import { joinNames, relativeTime } from "@/lib/format";
import { useReduced } from "@/app/session";
import { dur } from "@/design/motion";
import { telHref } from "@/lib/format";
import { cn } from "@/lib/cn";

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function Result() {
  const { requestId } = useParams();
  const { t, g, lang } = useG();
  const navigate = useNavigate();
  const reduced = useReduced();
  const record = useOutgoing(requestId);
  const member = useMember(record?.memberId);
  const now = useNow();
  const [why, setWhy] = useState(false);
  const [sayOpen, setSayOpen] = useState(false);
  const [closeAsk, setCloseAsk] = useState(false);
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // The back gesture never dismisses a verdict by accident.
  const blocker = useBlocker(({ historyAction }) => historyAction === "POP" && !leaving);
  useEffect(() => {
    if (blocker.state === "blocked") {
      setCloseAsk(true);
      blocker.reset();
    }
  }, [blocker]);

  if (record === null) return <Navigate to="/home" replace />;
  if (!record) return <div className="min-h-app bg-[#0A0E1F]" />;
  if (record.status === "pending") return <Navigate to={`/verify/waiting/${record.requestId}`} replace />;
  if (record.status === "cancelled" || !record.result) return <Navigate to="/home" replace />;

  const result = safeVerdict(record.result);
  const label = record.memberLabel;
  const tone = VERDICT_TONE[result.verdict];
  const onTone = tone === "amber" ? "dark" : "light";
  const phone = member?.phone;

  const leave = (to = "/home") => {
    setLeaving(true);
    navigate(to, { replace: true });
  };
  const again = async () => {
    const id = await checkAgain(record.requestId);
    if (id) {
      setLeaving(true);
      navigate(`/verify/waiting/${id}`, { replace: true });
    }
  };

  const keyAgo =
    result.answeredAt && (result.verdict === "VERIFIED" || result.verdict === "DENIED")
      ? t("v.keyAgo", { name: label, ago: relativeTime(result.answeredAt, lang, now) })
      : undefined;

  const doneBtn = (i: number, primary = false) => (
    <VerdictAction index={i} key="done">
      <Button full variant={primary ? "on-verdict" : "on-verdict-ghost"} tone={onTone} onClick={() => leave()}>
        {t("common.done")}
      </Button>
    </VerdictAction>
  );
  const whyBtn = (i: number, primary = false) => (
    <VerdictAction index={i} key="why">
      <Button full variant={primary ? "on-verdict" : "on-verdict-ghost"} tone={onTone} icon={<Info size={20} weight="bold" />} onClick={() => setWhy(true)}>
        {t("v.why")}
      </Button>
    </VerdictAction>
  );
  const againBtn = (i: number, key = "v.checkAgain", primary = false) => (
    <VerdictAction index={i} key="again">
      <Button full variant={primary ? "on-verdict" : "on-verdict-ghost"} tone={onTone} icon={<ArrowClockwise size={20} weight="bold" />} onClick={again}>
        {t(key)}
      </Button>
    </VerdictAction>
  );

  let title = "";
  let body: ReactNode = "";
  let bodyText = "";
  let content: ReactNode = null;
  let actions: ReactNode[] = [];

  switch (result.verdict) {
    case "VERIFIED": {
      title = t("v.ok.title");
      body = bodyText = t("v.ok.body", { name: label });
      if (result.confirmationWords) {
        content = (
          // E7 · Say-the-words
          <VerdictSection index={0} className="text-center">
            <p className="text-body font-medium">{t("v.sayWords", { name: label })}</p>
            <p className="mt-3 font-mono text-[1.75rem] font-semibold leading-tight tracking-[0.06em]">
              {result.confirmationWords[0]} <span className="opacity-60">·</span> {result.confirmationWords[1]}
            </p>
            <p className="mt-2 text-body-sm opacity-85">{t("v.sayWordsCaption")}</p>
          </VerdictSection>
        );
      }
      actions = [doneBtn(0, true), whyBtn(1), againBtn(2)];
      break;
    }
    case "DENIED": {
      title = t("v.denied.title", { name: label });
      bodyText = `${t("v.denied.body", { name: label })} ${t("v.denied.warn")}`;
      body = (
        <>
          {t("v.denied.body", { name: label })} <strong className="font-bold">{t("v.denied.warn")}</strong>
        </>
      );
      const status = record.alertStatus;
      content = (
        <div className="flex flex-col gap-2.5">
          <VerdictAction index={0}>
            <Button full variant="on-verdict" tone={onTone} icon={<ChatCircleText size={22} weight="duotone" />} onClick={() => setSayOpen(true)}>
              {t("v.say")}
            </Button>
          </VerdictAction>
          {phone && (
            <VerdictAction index={1}>
              <PhoneNumber number={phone} label={t("v.call", { name: label })} tone={onTone} />
            </VerdictAction>
          )}
          <VerdictAction index={2}>
            <div className="flex min-h-14 items-center gap-3 rounded-[18px] bg-white/10 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]" aria-live="polite">
              {status === "sent" ? (
                <CheckCircle size={24} weight="fill" className="shrink-0" aria-hidden />
              ) : status === "sending" || status === undefined ? (
                <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
              ) : (
                <UsersThree size={24} weight="duotone" className="shrink-0" aria-hidden />
              )}
              <span className="text-body-sm font-medium">
                {status === "sent"
                  ? t("v.familyAlerted", { names: joinNames(record.alertedLabels ?? [], lang) })
                  : status === "none"
                    ? t("v.familyNone")
                    : status === "failed"
                      ? t("v.familyFailed")
                      : t("v.familyAlerting")}
              </span>
            </div>
          </VerdictAction>
          <VerdictAction index={3}>
            <a
              href={telHref("1930")}
              className="flex min-h-14 items-center justify-center gap-2 rounded-full text-body font-semibold shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.45)] active:bg-white/10"
            >
              <PhoneCall size={20} weight="bold" aria-hidden /> {t("v.report")}
            </a>
          </VerdictAction>
        </div>
      );
      actions = [doneBtn(4, true), whyBtn(5), againBtn(6)];
      break;
    }
    case "NO_RESPONSE": {
      title = t("v.none.title");
      body = bodyText = t("v.none.body", { name: label });
      const network = result.noResponseReason === "offline" || result.noResponseReason === "relay_unreachable";
      content = (
        <div className="flex flex-col gap-2.5">
          {network && (
            <VerdictAction index={0}>
              <p className="flex items-center justify-center gap-2 rounded-[14px] bg-black/[0.08] px-4 py-3 text-center text-body font-semibold">
                <WarningCircle size={22} weight="bold" aria-hidden /> {t("v.none.network")}
              </p>
            </VerdictAction>
          )}
          <VerdictAction index={1}>
            {record.checkOnSentTo ? (
              <p className="flex min-h-14 items-center gap-3 rounded-[18px] bg-black/[0.08] px-4 py-3 text-body-sm font-semibold" aria-live="polite">
                <CheckCircle size={22} weight="fill" aria-hidden />
                {t("v.askFamilySent", { names: joinNames(record.checkOnSentTo, lang) })}
              </p>
            ) : (
              <Button
                full
                variant="on-verdict-ghost"
                tone="dark"
                loading={asking}
                icon={<UsersThree size={22} weight="duotone" />}
                onClick={async () => {
                  setAsking(true);
                  try {
                    await askFamilyToReach(record.requestId);
                  } finally {
                    setAsking(false);
                  }
                }}
              >
                {t("v.askFamily", { name: label })}
              </Button>
            )}
          </VerdictAction>
          {phone && (
            <VerdictAction index={2}>
              <PhoneNumber number={phone} label={t("v.call", { name: label })} tone="dark" />
            </VerdictAction>
          )}
        </div>
      );
      actions = [againBtn(3, "v.askAgain", true), doneBtn(4)];
      break;
    }
    case "INVALID": {
      title = t("v.fake.title");
      body = bodyText = t("v.fake.body", { name: label });
      content = (
        <VerdictSection index={0}>
          <p className="text-caption font-semibold uppercase tracking-[0.06em] opacity-80">{t("v.happened")}</p>
          <p className="mt-1.5 flex items-start gap-2.5 text-h3 font-semibold">
            <Prohibit size={24} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
            {t(`v.reasons.${result.invalidReason ?? "bad_signature"}`, { name: label })}
          </p>
        </VerdictSection>
      );
      actions = [whyBtn(1, true), againBtn(2), doneBtn(3)];
      break;
    }
    case "UNKNOWN_PERSON": {
      title = t("v.unknown.title");
      body = bodyText = t("v.unknown.body");
      content = (
        <VerdictSection index={0}>
          <ul className="flex flex-col gap-2.5">
            {[
              { icon: Prohibit, text: t("v.unknown.advice1") },
              { icon: PhoneSlash, text: t("v.unknown.advice2") },
              { icon: PhoneCall, text: t("v.unknown.advice3") },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-body font-semibold">
                <Icon size={22} weight="bold" aria-hidden className="shrink-0" /> {text}
              </li>
            ))}
          </ul>
        </VerdictSection>
      );
      actions = [doneBtn(1, true)];
      break;
    }
  }

  return (
    <>
      <VerdictScreen result={result} title={title} body={body} announceBody={bodyText} meta={keyAgo} actions={actions}>
        {content}
      </VerdictScreen>

      {/* "Close this result?" — in-page, never a browser dialog. */}
      <AnimatePresence>
        {closeAsk && (
          <m.div
            className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(10,14,31,0.35)] px-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? dur.reduced : dur.fast }}
          >
            <div className="w-full max-w-[448px]">
              <InlineConfirm
                open
                tone="verdict"
                message={t("v.closeQ")}
                detail={t("v.closeQBody")}
                confirmLabel={t("v.closeBtn")}
                cancelLabel={t("v.stay")}
                onCancel={() => setCloseAsk(false)}
                onConfirm={() => leave()}
              />
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {(result.verdict === "VERIFIED" || result.verdict === "DENIED" || result.verdict === "INVALID") && (
        <WhySheet open={why} onClose={() => setWhy(false)} result={result} name={label} />
      )}

      <Sheet open={sayOpen} onClose={() => setSayOpen(false)} labelledBy="say-title">
        <h2 id="say-title" className="text-caption font-semibold uppercase tracking-[0.06em] text-muted">
          {t("v.say")}
        </h2>
        <p className="mt-3 font-display text-[2rem] font-semibold leading-tight text-ink">{g("v.sayLine")}</p>
        <p className="mt-3 text-body text-ink-2">{t("v.sayLineHint", { name: label })}</p>
        <Button className="mt-6" full variant="secondary" onClick={() => setSayOpen(false)}>
          {t("common.close")}
        </Button>
      </Sheet>
    </>
  );
}

function VerdictSection({ index, children, className }: { index: number; children: ReactNode; className?: string }) {
  return (
    <VerdictAction index={index}>
      <div className={cn("rounded-[20px] bg-black/[0.12] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]", className)}>{children}</div>
    </VerdictAction>
  );
}
