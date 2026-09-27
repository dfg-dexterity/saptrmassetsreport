/**
 * Parametrização fiscal usada pelo produto Aplicações Financeiras (aba "Premissas" da planilha base):
 * tabelas regressivas de IRRF e IOF e lista de regimes de tributação.
 */

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
