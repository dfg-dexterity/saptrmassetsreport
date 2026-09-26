import { lazy, Suspense } from "react";
import { createHashRouter, createMemoryRouter, Navigate, type RouteObject } from "react-router";
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
import { RELATORIOS } from "./data/catalogo";
import { EM_ARTIFACT } from "./lib/ambiente";

// O catálogo de CDS (≈180 KB de metadados) é carregado sob demanda
const CdsCatalogo = lazy(() => import("./apps/CdsCatalogo").then((m) => ({ default: m.CdsCatalogo })));

const rotas: RouteObject[] = [
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
];

/** Rota inicial a partir de uma âncora simples (ex.: …#r07-concentracao), único formato que o viewer repassa. */
function rotaInicial(): string {
  try {
    const token = window.location.hash.replace(/^#\/?/, "");
    return RELATORIOS.some((r) => r.rota === `/${token}`) ? `/${token}` : "/";
  } catch {
    return "/";
  }
}

// Site / GitHub Pages: HashRouter (funciona em qualquer subpasta ou iframe, com links diretos por relatório).
// Viewer do claude.ai: navegação em memória, sem alterar a URL do frame.
export const router = EM_ARTIFACT
  ? createMemoryRouter(rotas, { initialEntries: [rotaInicial()] })
  : createHashRouter(rotas);
