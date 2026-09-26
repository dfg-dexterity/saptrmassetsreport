import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { Toaster } from "sonner";

/** Volta ao topo a cada troca de relatório (sem depender de sessionStorage, que pode estar bloqueado) */
function RolarAoTopo() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function RootLayout() {
  return (
    <div className="min-h-screen bg-page text-text">
      <Toaster position="bottom-center" richColors closeButton toastOptions={{ style: { fontFamily: "72, Arial, sans-serif" } }} />
      <RolarAoTopo />
      <Outlet />
    </div>
  );
}
