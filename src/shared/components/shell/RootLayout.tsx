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
      <Toaster
        position="bottom-center"
        theme="dark"
        closeButton
        toastOptions={{
          style: {
            fontFamily: "Figtree, system-ui, sans-serif",
            background: "#2e2e2e",
            color: "#f7f3e7",
            border: "1px solid rgba(247, 243, 231, 0.13)",
            borderLeft: "3px solid #009994",
            borderRadius: 0,
          },
        }}
      />
      <RolarAoTopo />
      <Outlet />
    </div>
  );
}
