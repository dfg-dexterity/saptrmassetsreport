import type { ClassificacaoCPC48 } from "./carteira";

/**
 * R08 – Títulos públicos federais (Tesouro Direto / Tesouro Nacional) – dados fictícios do ambiente de teste.
 * Parâmetros da aba "Premissas" da planilha base (títulos públicos federais) e posições da "Carteira-Mestre".
 */

export const PARAMETROS_TESOURO = {
  /** Taxa de custódia B3 a.a. sobre o saldo (cobrada semestralmente) */
  custodiaB3: 0.002,
  /** Tarifa do agente de custódia a.a. */
  taxaAgente: 0.0005,
  /** VNA da LFT na data de referência (Tesouro Nacional / ANBIMA) */
  vnaLFT: 17_842.35,
  /** VNA da NTN-B na data de referência (ANBIMA, VNA projetado) */
  vnaNTNB: 4_698.12,
  /** Data a que se referem os VNAs acima (último dado disponível) */
  dataVNA: "2026-03-31",
  /** Cupom da NTN-F: 10% a.a., pago semestralmente (jan/jul) */
  cupomNTNF: 0.1,
  /** Cupom da NTN-B: 6% a.a., pago semestralmente */
  cupomNTNB: 0.06,
  /** Valor de face de LTN e NTN-F (R$) */
  valorFace: 1000,
};

export type TipoTitulo = "LFT" | "LTN" | "NTN-F" | "NTN-B Principal" | "NTN-B";

export const TIPOS_TITULO: { tipo: TipoTitulo; nome: string; codigoSelic: string; descricao: string }[] = [
  { tipo: "LFT", nome: "Tesouro Selic", codigoSelic: "210100", descricao: "Pós-fixado: VNA corrigido pela Selic × cotação (ágio/deságio)" },
  { tipo: "LTN", nome: "Tesouro Prefixado", codigoSelic: "100000", descricao: "Prefixado sem cupom: R$ 1.000 no vencimento" },
  { tipo: "NTN-F", nome: "Tesouro Prefixado com Juros Semestrais", codigoSelic: "950199", descricao: "Prefixado com cupom de 10% a.a. (jan/jul)" },
  { tipo: "NTN-B Principal", nome: "Tesouro IPCA+", codigoSelic: "760100", descricao: "IPCA + taxa real, sem cupom" },
  { tipo: "NTN-B", nome: "Tesouro IPCA+ com Juros Semestrais", codigoSelic: "760199", descricao: "IPCA + taxa real, cupom de 6% a.a. sobre o VNA" },
];

export interface TituloPublico {
  id: string;
  transacao: string; // IFINTRAN.FINANCIALTRANSACTION
  empresa: string;
  tipo: TipoTitulo;
  /** "Tesouro Selic 2029" */
  nome: string;
  indexador: "Selic" | "Prefixado" | "IPCA";
  dataCompra: string;
  vencimento: string;
  quantidade: number;
  /** taxa de compra a.a. (LFT: ágio/deságio sobre a Selic) */
  taxaCompra: number;
  cpc48: ClassificacaoCPC48;
  portfolio: string;
  custodiante: string;
}

export const TITULOS: TituloPublico[] = [
  {
    id: "TD01",
    transacao: "40000011",
    empresa: "1000",
    tipo: "LFT",
    nome: "Tesouro Selic 2029",
    indexador: "Selic",
    dataCompra: "2025-03-17",
    vencimento: "2029-03-01",
    quantidade: 195,
    taxaCompra: 0.0009,
    cpc48: "Custo Amortizado",
    portfolio: "TES-SOBERANO",
    custodiante: "B3 · agente Banco Itaú",
  },
  {
    id: "TD02",
    transacao: "40000018",
    empresa: "1000",
    tipo: "LTN",
    nome: "Tesouro Prefixado 2028",
    indexador: "Prefixado",
    dataCompra: "2025-05-12",
    vencimento: "2028-01-01",
    quantidade: 3_426,
    taxaCompra: 0.132,
    cpc48: "VJ por ORA",
    portfolio: "TES-SOBERANO",
    custodiante: "B3 · agente Banco Itaú",
  },
  {
    id: "TD03",
    transacao: "40000023",
    empresa: "1000",
    tipo: "NTN-F",
    nome: "Tesouro Prefixado com Juros Semestrais 2031",
    indexador: "Prefixado",
    dataCompra: "2025-06-18",
    vencimento: "2031-01-01",
    quantidade: 1_944,
    taxaCompra: 0.1375,
    cpc48: "VJ por ORA",
    portfolio: "TES-SOBERANO",
    custodiante: "B3 · agente Banco Bradesco",
  },
  {
    id: "TD04",
    transacao: "40000015",
    empresa: "2000",
    tipo: "NTN-B Principal",
    nome: "Tesouro IPCA+ 2029",
    indexador: "IPCA",
    dataCompra: "2025-04-07",
    vencimento: "2029-05-15",
    quantidade: 594,
    taxaCompra: 0.0755,
    cpc48: "Custo Amortizado",
    portfolio: "TES-SOBERANO",
    custodiante: "B3 · agente Banco Bradesco",
  },
  {
    id: "TD05",
    transacao: "40000027",
    empresa: "3000",
    tipo: "NTN-B",
    nome: "Tesouro IPCA+ com Juros Semestrais 2030",
    indexador: "IPCA",
    dataCompra: "2025-07-22",
    vencimento: "2030-08-15",
    quantidade: 796,
    taxaCompra: 0.074,
    cpc48: "VJ por Resultado",
    portfolio: "TES-SOBERANO",
    custodiante: "B3 · agente Banco Itaú",
  },
];

/**
 * Taxas indicativas de mercado (ANBIMA) no fim de cada mês, importadas do SAP (dados de mercado de títulos).
 * LFT: ágio/deságio sobre a Selic; demais: taxa de compra a.a. Meses posteriores à data-base usam o último dado.
 */
export const TAXAS_MERCADO: Record<string, Record<string, number>> = {
  TD01: {
    "2025-03": 0.0009, "2025-04": 0.001, "2025-05": 0.0011, "2025-06": 0.001, "2025-07": 0.0009, "2025-08": 0.0008,
    "2025-09": 0.0007, "2025-10": 0.0007, "2025-11": 0.0006, "2025-12": 0.0006, "2026-01": 0.0005, "2026-02": 0.0005,
    "2026-03": 0.0004,
  },
  TD02: {
    "2025-05": 0.1335, "2025-06": 0.136, "2025-07": 0.1385, "2025-08": 0.137, "2025-09": 0.1355, "2025-10": 0.134,
    "2025-11": 0.133, "2025-12": 0.1325, "2026-01": 0.131, "2026-02": 0.1295, "2026-03": 0.1285,
  },
  TD03: {
    "2025-06": 0.1375, "2025-07": 0.1395, "2025-08": 0.138, "2025-09": 0.1365, "2025-10": 0.135, "2025-11": 0.134,
    "2025-12": 0.1335, "2026-01": 0.132, "2026-02": 0.131, "2026-03": 0.13,
  },
  TD04: {
    "2025-04": 0.076, "2025-05": 0.0765, "2025-06": 0.077, "2025-07": 0.0775, "2025-08": 0.0768, "2025-09": 0.076,
    "2025-10": 0.0765, "2025-11": 0.0772, "2025-12": 0.0778, "2026-01": 0.077, "2026-02": 0.0772, "2026-03": 0.0775,
  },
  TD05: {
    "2025-07": 0.0745, "2025-08": 0.0735, "2025-09": 0.073, "2025-10": 0.0738, "2025-11": 0.0742, "2025-12": 0.0748,
    "2026-01": 0.0735, "2026-02": 0.073, "2026-03": 0.0725,
  },
};
