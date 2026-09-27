import type { ClassificacaoCPC48, Rating } from "./carteira";
import type { RegimeIR } from "./tributacao";

/**
 * R09 – Fundos de investimento (dados fictícios do ambiente de teste): cotas, taxas de administração e performance,
 * come-cotas (mai/nov) e IR complementar no resgate. Posições da "Carteira-Mestre" da planilha base.
 */

export type ClasseFundo =
  | "Renda fixa referenciado DI"
  | "Renda fixa crédito privado"
  | "Multimercado macro"
  | "Renda fixa curto prazo"
  | "Ações"
  | "Cambial";

/** Como a cota rende: % do CDI (bruto), CDI + spread, série mensal (multimercado/ações) ou dólar + cupom cambial */
export type ModeloRetorno =
  | { tipo: "pctCDI"; pctBruto: number }
  | { tipo: "cdiMais"; spread: number }
  | { tipo: "serie"; serie: "multimercado" | "ibovespa"; alfaMensal: number; projecaoSpreadCDI: number }
  | { tipo: "cambial"; moeda: "USD"; cupom: number };

export interface Fundo {
  id: string;
  transacao: string;
  empresa: string;
  nome: string;
  gestor: string;
  administrador: string;
  cnpj: string;
  classe: ClasseFundo;
  /** produto usado nas regras de benchmark e nos agrupamentos */
  produto: "Fundo RF" | "Fundo crédito privado" | "Fundo multimercado" | "Fundo de ações" | "Fundo cambial";
  indexador: "CDI" | "Multimercado" | "Ibovespa" | "USD";
  benchmark: string;
  regimeIR: RegimeIR;
  modelo: ModeloRetorno;
  taxaAdm: number;
  /** taxa de performance sobre o que exceder o benchmark do fundo */
  taxaPerf: number;
  liquidez: string;
  /** dias corridos entre o pedido e o crédito do resgate */
  diasResgate: number;
  dataAplicacao: string;
  valorAplicado: number;
  /** cota na data da aplicação */
  cotaAplicacao: number;
  dataResgate?: string;
  grupo: string;
  rating: Rating;
  portfolio: string;
  cpc48: ClassificacaoCPC48;
}

export const FUNDOS: Fundo[] = [
  {
    id: "FI01",
    transacao: "50000101",
    empresa: "1000",
    nome: "Itaú Asset RF Referenciado DI",
    gestor: "Itaú Asset Management",
    administrador: "Itaú Unibanco S.A.",
    cnpj: "11.222.333/0001-01",
    classe: "Renda fixa referenciado DI",
    produto: "Fundo RF",
    indexador: "CDI",
    benchmark: "CDI",
    regimeIR: "Fundo LP (come-cotas 15%)",
    modelo: { tipo: "pctCDI", pctBruto: 1.01 },
    taxaAdm: 0.003,
    taxaPerf: 0,
    liquidez: "D+0",
    diasResgate: 0,
    dataAplicacao: "2025-01-02",
    valorAplicado: 2_500_000,
    cotaAplicacao: 3.84125,
    grupo: "Itaú Unibanco",
    rating: "AAA",
    portfolio: "TES-LIQUIDEZ",
    cpc48: "VJ por Resultado",
  },
  {
    id: "FI02",
    transacao: "50000108",
    empresa: "1000",
    nome: "BTG Crédito Corporativo LP",
    gestor: "BTG Pactual Asset",
    administrador: "BTG Pactual Serviços Financeiros DTVM",
    cnpj: "22.333.444/0001-02",
    classe: "Renda fixa crédito privado",
    produto: "Fundo crédito privado",
    indexador: "CDI",
    benchmark: "CDI",
    regimeIR: "Fundo LP (come-cotas 15%)",
    modelo: { tipo: "cdiMais", spread: 0.021 },
    taxaAdm: 0.0075,
    taxaPerf: 0,
    liquidez: "D+30",
    diasResgate: 30,
    dataAplicacao: "2025-02-10",
    valorAplicado: 1_800_000,
    cotaAplicacao: 1.62318,
    grupo: "BTG Pactual",
    rating: "AA",
    portfolio: "TES-CREDITO",
    cpc48: "VJ por Resultado",
  },
  {
    id: "FI03",
    transacao: "50000115",
    empresa: "1000",
    nome: "XP Macro Multimercado",
    gestor: "XP Asset",
    administrador: "XP Investimentos CCTVM",
    cnpj: "33.444.555/0001-03",
    classe: "Multimercado macro",
    produto: "Fundo multimercado",
    indexador: "Multimercado",
    benchmark: "CDI",
    regimeIR: "Fundo LP (come-cotas 15%)",
    modelo: { tipo: "serie", serie: "multimercado", alfaMensal: 0, projecaoSpreadCDI: 0.02 },
    taxaAdm: 0.02,
    taxaPerf: 0.2,
    liquidez: "D+30",
    diasResgate: 31,
    dataAplicacao: "2025-04-03",
    valorAplicado: 1_200_000,
    cotaAplicacao: 2.74590,
    grupo: "XP",
    rating: "AA",
    portfolio: "TES-APLIC",
    cpc48: "VJ por Resultado",
  },
  {
    id: "FI04",
    transacao: "50000122",
    empresa: "2000",
    nome: "Bradesco RF Curto Prazo",
    gestor: "Bradesco Asset",
    administrador: "Banco Bradesco S.A.",
    cnpj: "44.555.666/0001-04",
    classe: "Renda fixa curto prazo",
    produto: "Fundo RF",
    indexador: "CDI",
    benchmark: "CDI",
    regimeIR: "Fundo CP (come-cotas 20%)",
    modelo: { tipo: "pctCDI", pctBruto: 0.99 },
    taxaAdm: 0.005,
    taxaPerf: 0,
    liquidez: "D+0",
    diasResgate: 0,
    dataAplicacao: "2025-07-15",
    valorAplicado: 2_000_000,
    cotaAplicacao: 1.98731,
    grupo: "Bradesco",
    rating: "AAA",
    portfolio: "TES-LIQUIDEZ",
    cpc48: "VJ por Resultado",
  },
  {
    id: "FI05",
    transacao: "50000129",
    empresa: "3000",
    nome: "Itaú Ações Ibovespa Ativo",
    gestor: "Itaú Asset Management",
    administrador: "Itaú Unibanco S.A.",
    cnpj: "55.666.777/0001-05",
    classe: "Ações",
    produto: "Fundo de ações",
    indexador: "Ibovespa",
    benchmark: "Ibovespa",
    regimeIR: "Fundo de ações (15%)",
    modelo: { tipo: "serie", serie: "ibovespa", alfaMensal: 0.002, projecaoSpreadCDI: 0.03 },
    taxaAdm: 0.015,
    taxaPerf: 0.2,
    liquidez: "D+2",
    diasResgate: 4,
    dataAplicacao: "2025-08-20",
    valorAplicado: 800_000,
    cotaAplicacao: 12.40562,
    grupo: "Itaú Unibanco",
    rating: "AAA",
    portfolio: "TES-APLIC",
    cpc48: "VJ por Resultado",
  },
  {
    id: "FI06",
    transacao: "50000136",
    empresa: "3000",
    nome: "BB Cambial Dólar",
    gestor: "BB Asset",
    administrador: "BB DTVM",
    cnpj: "66.777.888/0001-06",
    classe: "Cambial",
    produto: "Fundo cambial",
    indexador: "USD",
    benchmark: "PTAX (USD)",
    regimeIR: "Fundo LP (come-cotas 15%)",
    modelo: { tipo: "cambial", moeda: "USD", cupom: 0.042 },
    taxaAdm: 0.01,
    taxaPerf: 0,
    liquidez: "D+1",
    diasResgate: 1,
    dataAplicacao: "2026-01-05",
    valorAplicado: 1_000_000,
    cotaAplicacao: 5.21874,
    grupo: "Banco do Brasil",
    rating: "AAA",
    portfolio: "TES-LIQUIDEZ",
    cpc48: "VJ por Resultado",
  },
  {
    id: "FI07",
    transacao: "50000094",
    empresa: "1000",
    nome: "Itaú Asset Soberano DI",
    gestor: "Itaú Asset Management",
    administrador: "Itaú Unibanco S.A.",
    cnpj: "77.888.999/0001-07",
    classe: "Renda fixa referenciado DI",
    produto: "Fundo RF",
    indexador: "CDI",
    benchmark: "CDI",
    regimeIR: "Fundo LP (come-cotas 15%)",
    modelo: { tipo: "pctCDI", pctBruto: 1.0 },
    taxaAdm: 0.002,
    taxaPerf: 0,
    liquidez: "D+0",
    diasResgate: 0,
    dataAplicacao: "2024-09-02",
    valorAplicado: 2_000_000,
    cotaAplicacao: 1.35218,
    dataResgate: "2026-03-10",
    grupo: "Itaú Unibanco",
    rating: "Soberano",
    portfolio: "TES-LIQUIDEZ",
    cpc48: "VJ por Resultado",
  },
];

/** Retornos mensais brutos importados do SAP (valorização de ativos): carteira do multimercado e Ibovespa */
export const RETORNOS_MENSAIS: Record<"multimercado" | "ibovespa", Record<string, number>> = {
  multimercado: {
    "2025-04": 0.0195, "2025-05": 0.0082, "2025-06": 0.0141, "2025-07": -0.0058, "2025-08": 0.0213, "2025-09": 0.0124,
    "2025-10": 0.0031, "2025-11": 0.0189, "2025-12": 0.0112, "2026-01": 0.0148, "2026-02": -0.0042, "2026-03": 0.0129,
  },
  ibovespa: {
    "2025-08": 0.0282, "2025-09": 0.034, "2025-10": -0.0183, "2025-11": 0.0421, "2025-12": -0.029, "2026-01": 0.0164,
    "2026-02": -0.0312, "2026-03": 0.0224,
  },
};
