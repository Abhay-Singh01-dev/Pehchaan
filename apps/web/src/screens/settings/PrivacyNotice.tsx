// I7 · Privacy notice (backend spec 17, FC-18): exactly what is kept, where, why and for how long, in plain
// language (English and Hindi), with the grievance contact. The inventory mirrors spec 17.1 row for row.
import * as m from "motion/react-m";
import { useTranslation } from "react-i18next";
import { DeviceMobile, CloudCheck, EnvelopeSimple } from "@phosphor-icons/react";
import { PageBody, PageTitle, Section } from "@/components/screen/Page";
import { TopBar } from "@/components/screen/TopBar";
import { appConfig } from "@/app/config";
import { useReduced } from "@/app/session";
import { riseIn } from "@/design/motion";

const ON_PHONE = ["family", "history"] as const;
const ON_SERVER = ["device", "contacts", "push", "envelopes", "ip", "security", "errors"] as const;

export function PrivacyNotice() {
  const { t } = useTranslation();
  const reduced = useReduced();
  const contact = appConfig.privacyContact;
  return (
    <>
      <TopBar title={t("privacy.title")} />
      <PageBody>
        <PageTitle sub={t("privacy.intro")}>{t("privacy.title")}</PageTitle>

        <m.div {...riseIn(1, reduced)}>
          <Section title={t("privacy.onPhoneTitle")}>
            <ul className="card divide-y divide-line">
              {ON_PHONE.map((k) => (
                <li key={k} className="flex gap-3 px-4 py-3.5">
                  <DeviceMobile size={22} className="mt-0.5 shrink-0 text-brand-ink" aria-hidden />
                  <span className="text-body text-ink">{t(`privacy.phone.${k}`)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </m.div>

        <m.div {...riseIn(2, reduced)}>
          <Section title={t("privacy.onServerTitle")}>
            <ul className="card divide-y divide-line">
              {ON_SERVER.map((k) => (
                <li key={k} className="flex gap-3 px-4 py-3.5">
                  <CloudCheck size={22} className="mt-0.5 shrink-0 text-brand-ink" aria-hidden />
                  <span className="text-body text-ink">{t(`privacy.server.${k}`)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-body-sm text-ink-2">{t("privacy.neverServer")}</p>
          </Section>
        </m.div>

        <m.div {...riseIn(3, reduced)}>
          <Section title={t("privacy.rightsTitle")}>
            <p className="text-body text-ink-2">{t("privacy.rights")}</p>
            <p className="mt-3 text-body-sm text-ink-2">{t("privacy.processors")}</p>
            <p className="mt-3 text-body-sm text-ink-2">{t("privacy.guard")}</p>
          </Section>
        </m.div>

        {contact && (
          <m.div {...riseIn(4, reduced)}>
            <Section title={t("privacy.contactTitle")}>
              <a
                href={`mailto:${contact}`}
                className="card flex items-center gap-3 px-4 py-3.5 text-body font-medium text-brand-ink"
              >
                <EnvelopeSimple size={22} aria-hidden /> {contact}
              </a>
            </Section>
          </m.div>
        )}
      </PageBody>
    </>
  );
}
