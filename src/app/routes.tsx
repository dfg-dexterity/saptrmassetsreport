import { lazy, Suspense } from "react";
import { createHashRouter, Navigate } from "react-router";
import { RootLayout } from "./components/shell/RootLayout";
import { Launchpad } from "./apps/Launchpad";
import { PremissasApp } from "./apps/PremissasApp";
import { R01Composicao } from "./apps/R01Composicao";
import { R02Movimentacao } from "./apps/R02Movimentacao";
import { R03Rentabilidade } from "./apps/R03Rentabilidade";
import { R04PrazoFiscal } from "./apps/R04PrazoFiscal";
import { R05Evolucao } from "./apps/R05Evolucao";
import { R06Indicadores } from "./apps/R06Indicadores";
import { R07Concentracao } from "./apps/R07Concentracao";
import { Carregando } from "./components/shell/Carregando";

// O catálogo de CDS (≈180 KB de metadados) é carregado sob demanda
const CdsCatalogo = lazy(() => import("./apps/CdsCatalogo").then((m) => ({ default: m.CdsCatalogo })));

// HashRouter: funciona em qualquer hospedagem estática (subpasta do site, GitHub Pages, iframe)
export const router = createHashRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: Launchpad },
      { path: "premissas", Component: PremissasApp },
      { path: "r01-composicao", Component: R01Composicao },
      { path: "r07-concentracao", Component: R07Concentracao },
      { path: "r05-evolucao", Component: R05Evolucao },
      { path: "r03-rentabilidade", Component: R03Rentabilidade },
      { path: "r04-prazo-fiscal", Component: R04PrazoFiscal },
      { path: "r06-indicadores", Component: R06Indicadores },
      { path: "r02-movimentacao", Component: R02Movimentacao },
      {
        path: "cds",
        element: (
          <Suspense fallback={<Carregando />}>
            <CdsCatalogo />
          </Suspense>
        ),
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
