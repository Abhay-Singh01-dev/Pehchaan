// Where the app opens (spec B12 A0), in this exact order:
//   1. a pending, unexpired incoming request → /request/:id
//   2. a family-link fragment → /join
//   3. not installed and install not dismissed → /install
//   4. no profile → /setup/language
//   5. setup not complete → resume the last setup step
//   6. otherwise → /home
import { useEffect } from "react";
import { useLocation } from "react-router";
import { pendingIncoming } from "@/store/requests";
import { getProfile } from "@/store/profile";
import { getMeta, setMeta } from "@/store/meta";
import { isStandalone } from "./pwa";

export async function decideStart(opts: { skipInstall?: boolean } = {}): Promise<string> {
  const pending = await pendingIncoming();
  if (pending[0]) return `/request/${pending[0].requestId}`;
  if (/[#&]c=/.test(window.location.hash)) return `/join${window.location.hash}`;
  if (!opts.skipInstall && !isStandalone() && !(await getMeta<boolean>("installDismissed"))) return "/install";
  const profile = await getProfile();
  if (!profile) return "/setup/language";
  if (!profile.setupComplete) return (await getMeta<string>("setupStep")) ?? "/setup/name";
  return "/home";
}

/** Remembers the current setup step so an interrupted setup resumes where it stopped (A0 #5). */
export function useRecordSetupStep() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (search.includes("from=settings")) return;
    void getProfile().then((p) => {
      if (!p?.setupComplete) void setMeta("setupStep", pathname);
    });
  }, [pathname, search]);
}
