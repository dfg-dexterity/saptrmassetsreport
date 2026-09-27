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

export type RegimeIR =
  | "Regressivo"
  | "Isento"
  | "15% fixo"
  | "Fundo LP (come-cotas 15%)"
  | "Fundo CP (come-cotas 20%)"
  | "Fundo de ações (15%)"
  | "Exterior – IRPJ/CSLL";

export const REGIMES_IR: { regime: RegimeIR; descricao: string }[] = [
  { regime: "Regressivo", descricao: "Tabela regressiva IRRF (padrão PJ, inclusive LCI/LCA/CRI)" },
  { regime: "Isento", descricao: "Sem IRRF" },
  { regime: "15% fixo", descricao: "Alíquota única de 15% (ex.: debênture incentivada Lei 12.431)" },
  { regime: "Fundo LP (come-cotas 15%)", descricao: "Come-cotas 15% em mai/nov; complemento regressivo no resgate" },
  { regime: "Fundo CP (come-cotas 20%)", descricao: "Come-cotas 20% em mai/nov; 22,5% até 180 dias / 20% acima" },
  { regime: "Fundo de ações (15%)", descricao: "15% no resgate; sem come-cotas e sem IOF" },
  { regime: "Exterior – IRPJ/CSLL", descricao: "Rendimento de PJ no exterior: sem IRRF, computado no lucro real – IRPJ/CSLL (Lei 9.249/1995, art. 25)" },
];

/** Come-cotas (Lei 14.754/2023): último dia útil de maio e de novembro */
export const COME_COTAS = {
  aliquotaLP: 0.15,
  aliquotaCP: 0.2,
  meses: [5, 11],
  aliquotaAcoes: 0.15,
  aliquotaMinimaCP: 0.2,
};

/** IRPJ (25%) + CSLL (9%) sobre o resultado de aplicações no exterior */
export const ALIQUOTA_IRPJ_CSLL = 0.34;

export const NOTA_PREMISSAS =
  "Para Pessoa Jurídica, a isenção de IR de LCI/LCA/CRI/CRA não se aplica – o IRRF é antecipação compensável com IRPJ. Fundos RF sofrem come-cotas (mai/nov).";
