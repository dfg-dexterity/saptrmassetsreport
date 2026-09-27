import { RouterProvider } from "react-router";
import { MercadoProvider } from "../shared/context/MercadoContext";
import { ProdutoProvider } from "../shared/context/ProdutoContext";
import { useAlertasCaptacoes } from "./context/useDivida";
import { PRODUTO_CAPTACOES } from "./produto";
import { router } from "./routes";

export default function App() {
  return (
    <MercadoProvider chave="dxt-captacoes-data-base">
      <ProdutoProvider info={PRODUTO_CAPTACOES} usarAlertas={useAlertasCaptacoes}>
        <RouterProvider router={router} />
      </ProdutoProvider>
    </MercadoProvider>
  );
}
