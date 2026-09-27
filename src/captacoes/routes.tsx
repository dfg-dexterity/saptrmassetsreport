import { lazy, Suspense } from "react";
import { createHashRouter, createMemoryRouter, Navigate, type RouteObject } from "react-router";
import { Carregando } from "../shared/components/shell/Carregando";
import { RootLayout } from "../shared/components/shell/RootLayout";
import { EM_ARTIFACT } from "../shared/lib/ambiente";
import { C00Carteira } from "./apps/C00Carteira";
import { C01Movimentacao } from "./apps/C01Movimentacao";
import { C02Cronograma } from "./apps/C02Cronograma";
import { C03Encargos } from "./apps/C03Encargos";
import { C04Covenants } from "./apps/C04Covenants";
import { C05Fechamento } from "./apps/C05Fechamento";
import { C06NotaExplicativa } from "./apps/C06NotaExplicativa";
import { KpisCaptacoes } from "./apps/KpisCaptacoes";
import { LaunchpadCaptacoes } from "./apps/LaunchpadCaptacoes";
import { PremissasCaptacoes } from "./apps/PremissasCaptacoes";
import { RELATORIOS_CAPTACOES } from "./data/catalogo";

// O catálogo de CDS (≈180 KB de metadados) é carregado sob demanda
const CdsCaptacoes = lazy(() => import("./apps/CdsCaptacoes").then((m) => ({ default: m.CdsCaptacoes })));

const rotas: RouteObject[] = [
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: LaunchpadCaptacoes },
      { path: "premissas", Component: PremissasCaptacoes },
      { path: "c00-carteira", Component: C00Carteira },
      { path: "c02-cronograma", Component: C02Cronograma },
      { path: "c01-movimentacao", Component: C01Movimentacao },
      { path: "c03-encargos", Component: C03Encargos },
      { path: "kpis", Component: KpisCaptacoes },
      { path: "c04-covenants", Component: C04Covenants },
      { path: "c05-fechamento", Component: C05Fechamento },
      { path: "c06-nota-explicativa", Component: C06NotaExplicativa },
      {
        path: "cds",
        element: (
          <Suspense fallback={<Carregando />}>
            <CdsCaptacoes />
          </Suspense>
        ),
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

/** Rota inicial a partir de uma âncora simples (ex.: …#c04-covenants), único formato que o viewer repassa. */
function rotaInicial(): string {
  try {
    const token = window.location.hash.replace(/^#\/?/, "");
    return RELATORIOS_CAPTACOES.some((r) => r.rota === `/${token}`) ? `/${token}` : "/";
  } catch {
    return "/";
  }
}

export const router = EM_ARTIFACT ? createMemoryRouter(rotas, { initialEntries: [rotaInicial()] }) : createHashRouter(rotas);
