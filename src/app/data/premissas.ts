/**
 * Aba "Premissas" do Reporting Pack – parâmetros de mercado e tabelas regressivas de IRRF/IOF.
 * Os valores padrão reproduzem a planilha base (data-base 31/03/2026).
 */

export interface Premissas {
  dataBase: string; // ISO
  cdi: number; // a.a. (fração)
  selic: number;
  ipca12m: number;
  baseDiasCorridos: number;
  baseDiasUteis: number;
  custoDivida: number; // a.a. (CDI + spread)
}

export const PREMISSAS_PADRAO: Premissas = {
  dataBase: "2026-03-31",
  cdi: 0.149,
  selic: 0.15,
  ipca12m: 0.045,
  baseDiasCorridos: 365,
  baseDiasUteis: 252,
  custoDivida: 0.167,
};

export interface FaixaIR {
  faixa: string;
  de: number;
  ate: number;
  aliquota: number;
}

/** Tabela regressiva IRRF – Renda fixa (Lei 11.033/2004) */
export const TABELA_IRRF: FaixaIR[] = [
  { faixa: "Até 180 dias", de: 0, ate: 180, aliquota: 0.225 },
  { faixa: "181 a 360 dias", de: 181, ate: 360, aliquota: 0.2 },
  { faixa: "361 a 720 dias", de: 361, ate: 720, aliquota: 0.175 },
  { faixa: "Acima de 720 dias", de: 721, ate: 99_999, aliquota: 0.15 },
];

/** Tabela regressiva IOF (Decreto 6.306/2007) – % sobre o rendimento, por dias corridos (1 a 29) */
export const TABELA_IOF: number[] = [
  0.96, 0.93, 0.9, 0.86, 0.83, 0.8, 0.76, 0.73, 0.7, 0.66, 0.63, 0.6, 0.56, 0.53, 0.5, 0.46, 0.43, 0.4, 0.36,
  0.33, 0.3, 0.26, 0.23, 0.2, 0.16, 0.13, 0.1, 0.06, 0.03,
];

export type RegimeIR = "Regressivo" | "Isento" | "15% fixo";

export const REGIMES_IR: { regime: RegimeIR; descricao: string }[] = [
  { regime: "Regressivo", descricao: "Tabela regressiva IRRF (padrão PJ, inclusive LCI/LCA/CRI)" },
  { regime: "Isento", descricao: "Sem IRRF" },
  { regime: "15% fixo", descricao: "Alíquota única de 15% (ex.: debênture incentivada Lei 12.431)" },
];

export const NOTA_PREMISSAS =
  "Para Pessoa Jurídica, a isenção de IR de LCI/LCA/CRI/CRA não se aplica – o IRRF é antecipação compensável com IRPJ. Fundos RF sofrem come-cotas (mai/nov).";

/**
 * CDI médio mensal (% a.a.) usado para apropriar os rendimentos históricos.
 * Meses posteriores à tabela usam o CDI vigente informado nas Premissas.
 */
export const CDI_MENSAL: Record<string, number> = {
  "2024-01": 0.1165,
  "2024-02": 0.1115,
  "2024-03": 0.109,
  "2024-04": 0.1065,
  "2024-05": 0.104,
  "2024-06": 0.104,
  "2024-07": 0.104,
  "2024-08": 0.104,
  "2024-09": 0.1065,
  "2024-10": 0.1075,
  "2024-11": 0.1115,
  "2024-12": 0.1165,
  "2025-01": 0.1215,
  "2025-02": 0.1315,
  "2025-03": 0.1365,
  "2025-04": 0.1415,
  "2025-05": 0.144,
  "2025-06": 0.1465,
  "2025-07": 0.149,
  "2025-08": 0.149,
  "2025-09": 0.149,
  "2025-10": 0.149,
  "2025-11": 0.149,
  "2025-12": 0.149,
  "2026-01": 0.149,
  "2026-02": 0.149,
  "2026-03": 0.149,
};

export const ULTIMO_MES_CDI = "2026-03";
