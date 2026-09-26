// Root: boots the device, then mounts the family app, or the laptop tools (/lab, /guard).
// All routes are public: there is no login and there are no auth guards (spec B11, B16).
import { lazy, Suspense, useEffect } from "react";
import { createBrowserRouter, Route, RouterProvider, Routes } from "react-router";
import { Providers } from "./Providers";
import { FamilyApp } from "./FamilyApp";
import { bootstrap } from "./bootstrap";
import { useSession } from "./session";
import { flags } from "./flags";
import { SimulationBadge } from "@/components/SimulationBadge";
import { ToastHost } from "@/components/Toasts";
import { RouteError } from "./RouteError";

const Lab = lazy(() => import("@/screens/lab/Lab").then((m) => ({ default: m.Lab })));
const Guard = lazy(() => import("@/screens/guard/Guard").then((m) => ({ default: m.Guard })));

function Blank() {
  return <div className="frame-bg min-h-app" />;
}

function Root() {
  const ready = useSession((s) => s.ready);
  useEffect(() => {
    void bootstrap();
  }, []);
  if (!ready) return <div className="min-h-app bg-bg" />;
  return (
    <Providers>
      <Routes>
        {flags.ENABLE_LAB && (
          <Route
            path="/lab"
            element={
              <Suspense fallback={<Blank />}>
                <Lab />
                <SimulationBadge />
                <ToastHost />
              </Suspense>
            }
          />
        )}
        {flags.ENABLE_GUARD && (
          <Route
            path="/guard"
            element={
              <Suspense fallback={<Blank />}>
                <Guard />
                <SimulationBadge />
                <ToastHost />
              </Suspense>
            }
          />
        )}
        <Route path="*" element={<FamilyApp />} />
      </Routes>
    </Providers>
  );
}

const router = createBrowserRouter([{ path: "*", element: <Root />, errorElement: <RouteError /> }]);

export function App() {
  return <RouterProvider router={router} />;
}
