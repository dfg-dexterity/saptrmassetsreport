import { RouterProvider } from "react-router";
import { PremissasProvider } from "./context/PremissasContext";
import { router } from "./routes";

export default function App() {
  return (
    <PremissasProvider>
      <RouterProvider router={router} />
    </PremissasProvider>
  );
}
