import type { RegimeIR } from "./tributacao";

/**
 * Carteira de renda fixa bancária (R01) – dados fictícios para demonstração. Títulos públicos (R08), fundos (R09) e
 * time deposits (R10) têm cadastros próprios e são consolidados na Carteira-Mestre.
 * Estrutura espelha a aba DD-31 (R01) e os campos das CDS Views IFINTRAN / IFINTRSMANAGE / IFINTRANSCNDN.
 * Operações com vencimento (ou resgate) anterior à data-base alimentam a movimentação (R02/R05).
 */

export type Produto =
  | "CDB"
  | "LCI"
  | "LCA"
  | "LF"
  | "Compromissada"
  | "Fundo RF"
  | "Tesouro Selic"
  | "Tesouro Prefixado"
  | "Debênture"
  | "CRI"
  | "CRA";

export type Indexador = "CDI" | "Selic" | "IPCA" | "Pré";
export type ClassificacaoCPC48 = "Custo Amortizado" | "VJ por ORA" | "VJ por Resultado";
export type Rating = "Soberano" | "AAA" | "AA" | "A";
export type Liquidez = "Diária" | "D+1" | "No vencimento";

export interface Operacao {
  transacao: string; // IFINTRAN.FINANCIALTRANSACTION
  empresa: string; // IFINTRAN.COMPANYCODE
  contraparte: string; // IFINTRAN.COUNTERPARTY
  grupo: string; // grupo econômico (limite de concentração)
  rating: Rating;
  produto: Produto; // IFINTRAN.FINANCIALINSTRUMENTPRODUCTTYPE
  indexador: Indexador; // IFINTRSMANAGE.INTERESTREFERENCE
  /** % do CDI (1.03 = 103%) para CDI; spread a.a. para Selic/IPCA; taxa a.a. para Pré */
  taxa: number; // IFINTRANSCNDN.FINANCIALCONDITIONPAYMENTRATE
  portfolio: string; // IFINTRAN.PORTFOLIO
  calendario: string; // IFINTRAN.FINTRANSFACTORYCALENDAR1
  dataAplicacao: string; // IFINTRAN.TERMSTARTDATE
  dataVencimento: string | null; // IFINTRAN.TERMENDDATE
  dataResgate?: string; // resgate antecipado / total (fundos)
  principal: number; // IFINTRSMANAGE.FINTRANSFLOWNOMAMT
  liquidez: Liquidez;
  regimeIR: RegimeIR;
  cpc48: ClassificacaoCPC48;
  /** Ajuste a valor justo em relação à curva (fração) */
  ajusteVJ: number;
}

export { EMPRESAS, EMPRESA_CONTROLADORA } from "../../shared/data/empresas";

type Base = Omit<Operacao, "calendario">;

const ops: Base[] = [
  // ------------------------------------------------------------------ Em carteira (data-base 31/03/2026)
  { transacao: "10000231", empresa: "1000", contraparte: "Banco Itaú", grupo: "Itaú Unibanco", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.03, portfolio: "TES-APLIC", dataAplicacao: "2025-06-16", dataVencimento: "2027-06-15", principal: 8_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0012 },
  { transacao: "10000244", empresa: "1000", contraparte: "Banco Bradesco", grupo: "Bradesco", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.015, portfolio: "TES-APLIC", dataAplicacao: "2025-09-01", dataVencimento: "2026-09-01", principal: 5_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0006 },
  { transacao: "10000262", empresa: "1000", contraparte: "Banco Safra", grupo: "Safra", rating: "AA", produto: "LCI", indexador: "CDI", taxa: 0.94, portfolio: "TES-APLIC", dataAplicacao: "2026-02-10", dataVencimento: "2027-02-10", principal: 2_500_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0004 },
  { transacao: "10000198", empresa: "1000", contraparte: "BTG Pactual", grupo: "BTG Pactual", rating: "AA", produto: "LCA", indexador: "CDI", taxa: 0.92, portfolio: "TES-APLIC", dataAplicacao: "2025-04-20", dataVencimento: "2026-04-20", principal: 1_500_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0001 },
  { transacao: "10000112", empresa: "1000", contraparte: "XP Investimentos", grupo: "XP", rating: "AA", produto: "Debênture", indexador: "IPCA", taxa: 0.065, portfolio: "TES-CREDITO", dataAplicacao: "2024-06-01", dataVencimento: "2029-06-01", principal: 4_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "VJ por ORA", ajusteVJ: 0.0145 },
  { transacao: "10000121", empresa: "1000", contraparte: "Banco Inter", grupo: "Inter", rating: "A", produto: "CRI", indexador: "IPCA", taxa: 0.07, portfolio: "TES-CREDITO", dataAplicacao: "2024-07-01", dataVencimento: "2030-07-01", principal: 1_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "VJ por ORA", ajusteVJ: 0.0061 },
  { transacao: "10000281", empresa: "1000", contraparte: "Banco Santander", grupo: "Santander", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.0, portfolio: "TES-LIQUIDEZ", dataAplicacao: "2026-03-16", dataVencimento: "2027-03-16", principal: 3_500_000, liquidez: "Diária", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0 },
  { transacao: "10000286", empresa: "1000", contraparte: "Banco do Brasil", grupo: "Banco do Brasil", rating: "AAA", produto: "Compromissada", indexador: "CDI", taxa: 0.965, portfolio: "TES-LIQUIDEZ", dataAplicacao: "2026-03-24", dataVencimento: "2026-04-07", principal: 6_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0 },
  { transacao: "10000133", empresa: "1000", contraparte: "Caixa Econômica Federal", grupo: "Caixa", rating: "AAA", produto: "LF", indexador: "CDI", taxa: 1.103, portfolio: "TES-APLIC", dataAplicacao: "2024-11-18", dataVencimento: "2026-11-18", principal: 4_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0028 },
  { transacao: "10000247", empresa: "1000", contraparte: "Banco Votorantim", grupo: "Votorantim", rating: "AA", produto: "CDB", indexador: "CDI", taxa: 1.04, portfolio: "TES-APLIC", dataAplicacao: "2025-10-06", dataVencimento: "2026-10-06", principal: 2_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0009 },
  { transacao: "10000176", empresa: "1000", contraparte: "Transmissora Alfa S.A.", grupo: "Transmissora Alfa", rating: "AA", produto: "Debênture", indexador: "IPCA", taxa: 0.058, portfolio: "TES-CREDITO", dataAplicacao: "2025-02-14", dataVencimento: "2032-02-15", principal: 1_500_000, liquidez: "No vencimento", regimeIR: "15% fixo", cpc48: "VJ por ORA", ajusteVJ: 0.0092 },
  { transacao: "20000118", empresa: "2000", contraparte: "Banco Itaú", grupo: "Itaú Unibanco", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.02, portfolio: "TES-APLIC", dataAplicacao: "2025-08-11", dataVencimento: "2026-08-11", principal: 3_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0005 },
  { transacao: "20000127", empresa: "2000", contraparte: "Sicredi", grupo: "Sicredi", rating: "AA", produto: "LCA", indexador: "CDI", taxa: 0.93, portfolio: "TES-APLIC", dataAplicacao: "2025-12-01", dataVencimento: "2026-12-01", principal: 1_200_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0003 },
  { transacao: "20000131", empresa: "2000", contraparte: "Banco do Brasil", grupo: "Banco do Brasil", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.005, portfolio: "TES-APLIC", dataAplicacao: "2026-01-19", dataVencimento: "2027-01-19", principal: 2_200_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0002 },
  { transacao: "30000071", empresa: "3000", contraparte: "Banco Santander", grupo: "Santander", rating: "AAA", produto: "LF", indexador: "CDI", taxa: 1.09, portfolio: "TES-APLIC", dataAplicacao: "2025-07-01", dataVencimento: "2027-07-01", principal: 3_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0021 },
  { transacao: "30000054", empresa: "3000", contraparte: "Agro Securitizadora Beta", grupo: "Securitizadora Beta", rating: "AA", produto: "CRA", indexador: "IPCA", taxa: 0.062, portfolio: "TES-CREDITO", dataAplicacao: "2025-03-10", dataVencimento: "2029-03-10", principal: 1_500_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "VJ por ORA", ajusteVJ: -0.0041 },
  { transacao: "30000075", empresa: "3000", contraparte: "Banco Safra", grupo: "Safra", rating: "AA", produto: "CDB", indexador: "CDI", taxa: 1.028, portfolio: "TES-APLIC", dataAplicacao: "2025-09-22", dataVencimento: "2026-06-22", principal: 2_500_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0004 },

  // ------------------------------------------------------------------ Liquidadas (movimentação histórica)
  { transacao: "10000102", empresa: "1000", contraparte: "Banco Itaú", grupo: "Itaú Unibanco", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.03, portfolio: "TES-APLIC", dataAplicacao: "2025-01-15", dataVencimento: "2026-01-15", principal: 5_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0005 },
  { transacao: "10000108", empresa: "1000", contraparte: "Banco Bradesco", grupo: "Bradesco", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.0, portfolio: "TES-APLIC", dataAplicacao: "2025-03-01", dataVencimento: "2025-09-01", principal: 3_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0002 },
  { transacao: "10000105", empresa: "1000", contraparte: "Banco Safra", grupo: "Safra", rating: "AA", produto: "LCI", indexador: "CDI", taxa: 0.94, portfolio: "TES-APLIC", dataAplicacao: "2025-02-10", dataVencimento: "2026-02-10", principal: 2_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0002 },
  { transacao: "10000191", empresa: "1000", contraparte: "Banco do Brasil", grupo: "Banco do Brasil", rating: "AAA", produto: "Compromissada", indexador: "CDI", taxa: 0.965, portfolio: "TES-LIQUIDEZ", dataAplicacao: "2025-04-01", dataVencimento: "2025-04-15", principal: 5_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0 },
  { transacao: "20000061", empresa: "2000", contraparte: "Banco Santander", grupo: "Santander", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.0, portfolio: "TES-APLIC", dataAplicacao: "2024-11-11", dataVencimento: "2025-05-12", principal: 2_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0001 },
  { transacao: "10000207", empresa: "1000", contraparte: "Caixa Econômica Federal", grupo: "Caixa", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.01, portfolio: "TES-APLIC", dataAplicacao: "2025-05-05", dataVencimento: "2025-11-05", principal: 4_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0002 },
  { transacao: "30000048", empresa: "3000", contraparte: "Banco do Brasil", grupo: "Banco do Brasil", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.0, portfolio: "TES-APLIC", dataAplicacao: "2025-04-07", dataVencimento: "2025-10-07", principal: 1_800_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0001 },
  { transacao: "10000255", empresa: "1000", contraparte: "Banco do Brasil", grupo: "Banco do Brasil", rating: "AAA", produto: "Compromissada", indexador: "CDI", taxa: 0.965, portfolio: "TES-LIQUIDEZ", dataAplicacao: "2025-12-15", dataVencimento: "2026-01-05", principal: 3_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0 },
  { transacao: "20000094", empresa: "2000", contraparte: "Banco Itaú", grupo: "Itaú Unibanco", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.0, portfolio: "TES-APLIC", dataAplicacao: "2025-06-02", dataVencimento: "2025-12-02", principal: 1_500_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0001 },
  { transacao: "10000094", empresa: "1000", contraparte: "XP Investimentos", grupo: "XP", rating: "AA", produto: "LCA", indexador: "CDI", taxa: 0.92, portfolio: "TES-APLIC", dataAplicacao: "2024-08-05", dataVencimento: "2025-08-05", principal: 1_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0001 },
  { transacao: "10000089", empresa: "1000", contraparte: "Banco Itaú", grupo: "Itaú Unibanco", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.03, portfolio: "TES-APLIC", dataAplicacao: "2024-10-14", dataVencimento: "2025-10-14", principal: 6_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0002 },
  { transacao: "30000031", empresa: "3000", contraparte: "Banco Santander", grupo: "Santander", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.005, portfolio: "TES-APLIC", dataAplicacao: "2024-12-02", dataVencimento: "2025-06-02", principal: 4_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0001 },
  { transacao: "10000187", empresa: "1000", contraparte: "Banco do Brasil", grupo: "Banco do Brasil", rating: "AAA", produto: "Compromissada", indexador: "CDI", taxa: 0.965, portfolio: "TES-LIQUIDEZ", dataAplicacao: "2025-03-20", dataVencimento: "2025-04-03", principal: 4_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0 },
  { transacao: "20000072", empresa: "2000", contraparte: "Banco Bradesco", grupo: "Bradesco", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.01, portfolio: "TES-APLIC", dataAplicacao: "2025-01-06", dataVencimento: "2025-07-07", principal: 2_500_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0001 },
  { transacao: "10000081", empresa: "1000", contraparte: "Caixa Econômica Federal", grupo: "Caixa", rating: "AAA", produto: "CDB", indexador: "CDI", taxa: 1.02, portfolio: "TES-APLIC", dataAplicacao: "2024-07-15", dataVencimento: "2025-07-15", principal: 5_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0001 },
  { transacao: "30000022", empresa: "3000", contraparte: "Banco Safra", grupo: "Safra", rating: "AA", produto: "CDB", indexador: "CDI", taxa: 1.02, portfolio: "TES-APLIC", dataAplicacao: "2024-08-19", dataVencimento: "2025-08-19", principal: 3_000_000, liquidez: "No vencimento", regimeIR: "Regressivo", cpc48: "Custo Amortizado", ajusteVJ: 0.0001 },
];

export const OPERACOES: Operacao[] = ops.map((o) => ({ ...o, calendario: "BR" }));

/** Limites da política de investimentos (R07) */
export const LIMITE_POR_RATING: Record<Rating, number> = {
  Soberano: 1,
  AAA: 0.25,
  AA: 0.15,
  A: 0.05,
};

export interface RegraPolitica {
  id: string;
  regra: string;
  tipo: "max" | "min";
  limite: number;
}

export const REGRAS_POLITICA: RegraPolitica[] = [
  { id: "credito", regra: "Crédito privado (Debênture, CRI, CRA e fundos de crédito)", tipo: "max", limite: 0.2 },
  { id: "fundos", regra: "Fundos de investimento", tipo: "max", limite: 0.2 },
  { id: "liquidez", regra: "Liquidez imediata (diária/D+1, fundos D+0/D+1 ou vencimento ≤ 30 dias)", tipo: "min", limite: 0.2 },
  { id: "longo", regra: "Prazo remanescente acima de 2 anos", tipo: "max", limite: 0.25 },
  { id: "pre", regra: "Exposição prefixada em R$ (inclui LTN e NTN-F)", tipo: "max", limite: 0.1 },
  { id: "exterior", regra: "Exposição cambial (time deposits e fundo cambial)", tipo: "max", limite: 0.1 },
  { id: "rv", regra: "Renda variável (fundos de ações e multimercado)", tipo: "max", limite: 0.05 },
];
