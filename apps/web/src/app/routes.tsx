// Every family-app route (spec B11). Screens are grouped by area into lazy chunks; Splash and
// Home load with the app. Lab and Guard are laptop pages mounted outside the family shell.
import { Navigate, Route } from "react-router";
import { flags } from "./flags";
import { lazyNamed, markCritical } from "./lazy";
import { Splash } from "@/screens/setup/Splash";
import { Home } from "@/screens/home/Home";

const setup = () => import("@/screens/setup");
const family = () => import("@/screens/family");
const scan = () => import("@/screens/family/Scan");
const myCode = () => import("@/screens/family/MyCode");
const verify = () => import("@/screens/verify");
const result = () => import("@/screens/verify/Result");
const answer = () => import("@/screens/answer");
// Asking, the verdict and answering must open even if the network drops mid-check (fail closed, never blank).
markCritical(verify, result, answer);
const alerts = () => import("@/screens/alerts/Alerts");
const history = () => import("@/screens/history");
const settings = () => import("@/screens/settings");
const help = () => import("@/screens/help");
const diagnostics = () => import("@/screens/diagnostics/Diagnostics");

const Install = lazyNamed(setup, "Install");
const Language = lazyNamed(setup, "Language");
const Welcome = lazyNamed(setup, "Welcome");
const NameStep = lazyNamed(setup, "NameStep");
const RoleStep = lazyNamed(setup, "RoleStep");
const KeyStep = lazyNamed(setup, "KeyStep");
const Done = lazyNamed(setup, "Done");
const Notifications = lazyNamed(setup, "Notifications");

const FamilyList = lazyNamed(family, "FamilyList");
const AddFamily = lazyNamed(family, "AddFamily");
const ConfirmMember = lazyNamed(family, "ConfirmMember");
const MemberDetail = lazyNamed(family, "MemberDetail");
const Join = lazyNamed(family, "Join");
const FarAway = lazyNamed(family, "FarAway");
const Scan = lazyNamed(scan, "Scan");
const MyCode = lazyNamed(myCode, "MyCode");

const Who = lazyNamed(verify, "Who");
const What = lazyNamed(verify, "What");
const Waiting = lazyNamed(verify, "Waiting");
const Official = lazyNamed(verify, "Official");
const PaymentCheck = lazyNamed(verify, "PaymentCheck");
const Result = lazyNamed(result, "Result");

const Incoming = lazyNamed(answer, "Incoming");
const Sent = lazyNamed(answer, "Sent");

const Alerts = lazyNamed(alerts, "Alerts");
const History = lazyNamed(history, "History");
const HistoryDetail = lazyNamed(history, "HistoryDetail");

const Settings = lazyNamed(settings, "Settings");
const ProfileEdit = lazyNamed(settings, "ProfileEdit");
const MyKey = lazyNamed(settings, "MyKey");
const Display = lazyNamed(settings, "Display");
const LanguageSettings = lazyNamed(settings, "LanguageSettings");
const DeleteAll = lazyNamed(settings, "DeleteAll");
const PrivacyNotice = lazyNamed(settings, "PrivacyNotice");
const WhoCanReach = lazyNamed(settings, "WhoCanReach");
const AlertsSettings = lazyNamed(settings, "AlertsSettings");

const HowItWorks = lazyNamed(help, "HowItWorks");
const Limits = lazyNamed(help, "Limits");
const SuspiciousCall = lazyNamed(help, "SuspiciousCall");
const Practice = lazyNamed(help, "Practice");

const Diagnostics = lazyNamed(diagnostics, "Diagnostics");

export function familyRoutes() {
  const X = flags.ENABLE_EXTRAS;
  return (
    <>
      <Route path="/" element={<Splash />} />
      <Route path="/install" element={<Install />} />
      <Route path="/setup/language" element={<Language />} />
      <Route path="/setup/welcome" element={<Welcome />} />
      <Route path="/setup/name" element={<NameStep />} />
      <Route path="/setup/role" element={<RoleStep />} />
      <Route path="/setup/key" element={<KeyStep />} />
      <Route path="/setup/done" element={<Done />} />
      {/* A8 is no longer an extra (backend spec 22, FC-8). */}
      <Route path="/setup/notifications" element={<Notifications />} />

      <Route path="/home" element={<Home />} />
      <Route path="/alerts" element={<Alerts />} />

      <Route path="/family" element={<FamilyList />} />
      <Route path="/family/add" element={<AddFamily />} />
      <Route path="/family/my-code" element={<MyCode />} />
      <Route path="/family/scan" element={<Scan />} />
      <Route path="/family/confirm" element={<ConfirmMember />} />
      {X && <Route path="/family/far-away" element={<FarAway />} />}
      <Route path="/family/:memberId" element={<MemberDetail />} />
      <Route path="/join" element={<Join />} />

      <Route path="/verify/who" element={<Who />} />
      <Route path="/verify/what" element={<What />} />
      <Route path="/verify/waiting/:requestId" element={<Waiting />} />
      <Route path="/verify/official" element={<Official />} />
      {X && <Route path="/verify/payment" element={<PaymentCheck />} />}
      <Route path="/verify/result/:requestId" element={<Result />} />

      <Route path="/request/:requestId" element={<Incoming />} />
      <Route path="/request/:requestId/sent" element={<Sent />} />

      <Route path="/history" element={<History />} />
      <Route path="/history/:eventId" element={<HistoryDetail />} />

      <Route path="/settings" element={<Settings />} />
      <Route path="/settings/profile" element={<ProfileEdit />} />
      <Route path="/settings/key" element={<MyKey />} />
      <Route path="/settings/display" element={<Display />} />
      <Route path="/settings/language" element={<LanguageSettings />} />
      <Route path="/settings/delete" element={<DeleteAll />} />
      <Route path="/settings/privacy" element={<PrivacyNotice />} />
      <Route path="/settings/reach" element={<WhoCanReach />} />
      <Route path="/settings/alerts" element={<AlertsSettings />} />

      <Route path="/help/how-it-works" element={<HowItWorks />} />
      <Route path="/help/limits" element={<Limits />} />
      <Route path="/help/suspicious-call" element={<SuspiciousCall />} />
      {X && <Route path="/help/practice" element={<Practice />} />}

      <Route path="/diagnostics" element={<Diagnostics />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </>
  );
}
