import { RouterProvider } from "react-router";
import { MercadoProvider } from "../shared/context/MercadoContext";
import { ProdutoProvider } from "../shared/context/ProdutoContext";
import { BenchmarkProvider } from "./context/BenchmarkContext";
import { useAlertas } from "./context/useDados";
import { PRODUTO_APLICACOES } from "./produto";
import { router } from "./routes";

export default function App() {
  return (
    <MercadoProvider chave="dxt-aplicacoes-data-base">
      <BenchmarkProvider>
        <ProdutoProvider info={PRODUTO_APLICACOES} usarAlertas={useAlertas}>
          <RouterProvider router={router} />
        </ProdutoProvider>
      </BenchmarkProvider>
    </MercadoProvider>
  );
}
