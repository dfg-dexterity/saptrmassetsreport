import { Outlet, ScrollRestoration } from "react-router";
import { Toaster } from "sonner";

export function RootLayout() {
  return (
    <div className="min-h-screen bg-page text-text">
      <Toaster position="bottom-center" richColors closeButton toastOptions={{ style: { fontFamily: "72, Arial, sans-serif" } }} />
      <Outlet />
      <ScrollRestoration />
    </div>
  );
}
