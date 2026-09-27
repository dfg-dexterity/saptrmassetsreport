/**
 * C04 – Covenants financeiros das captações (dados fictícios do ambiente de teste).
 */

export type CovenantId = "dlEbitda" | "icsd" | "capitalizacao" | "ebitdaDespFin" | "dlImoveisPl";

export interface CovenantDivida {
  id: CovenantId;
  indicador: string;
  formula: string;
  tipo: "max" | "min";
  limite: number;
  /** faixa de atenção (folga pequena) */
  alerta: number;
  formato: "x" | "pct";
  periodicidade: "Trimestral" | "Anual";
  contratos: string[];
  fonte: string;
}

export const COVENANTS_DIVIDA: CovenantDivida[] = [
  {
    id: "dlEbitda",
    indicador: "Dívida líquida / EBITDA",
    formula: "(Dívida bruta − caixa − aplicações financeiras) ÷ EBITDA dos últimos 12 meses",
    tipo: "max",
    limite: 3.0,
    alerta: 2.5,
    formato: "x",
    periodicidade: "Trimestral",
    contratos: ["DEB-01", "DEB-03", "CCB-01"],
    fonte: "Escrituras da 1ª e 2ª emissões de debêntures e CCB nº 7731",
  },
  {
    id: "icsd",
    indicador: "ICSD – cobertura do serviço da dívida",
    formula: "Geração de caixa do exercício ÷ serviço da dívida (principal + juros pagos no exercício)",
    tipo: "min",
    limite: 1.3,
    alerta: 1.4,
    formato: "x",
    periodicidade: "Anual",
    contratos: ["BND-01", "BND-02"],
    fonte: "Contratos BNDES FINEM (direto e indireto)",
  },
  {
    id: "capitalizacao",
    indicador: "Índice de capitalização",
    formula: "Patrimônio líquido ÷ ativo total",
    tipo: "min",
    limite: 0.3,
    alerta: 0.33,
    formato: "pct",
    periodicidade: "Anual",
    contratos: ["BND-01", "BND-02"],
    fonte: "Contratos BNDES FINEM (direto e indireto)",
  },
  {
    id: "ebitdaDespFin",
    indicador: "EBITDA / despesa financeira",
    formula: "EBITDA ÷ encargos financeiros da dívida dos últimos 12 meses",
    tipo: "min",
    limite: 2.0,
    alerta: 2.5,
    formato: "x",
    periodicidade: "Trimestral",
    contratos: ["DEB-02", "CRA-01", "CRA-02"],
    fonte: "Escritura da debênture incentivada e termos de securitização dos CRA",
  },
  {
    id: "dlImoveisPl",
    indicador: "(Dívida líquida + imóveis a pagar) / PL",
    formula: "(Dívida líquida + obrigações por aquisição de imóveis) ÷ patrimônio líquido",
    tipo: "max",
    limite: 0.5,
    alerta: 0.4,
    formato: "x",
    periodicidade: "Trimestral",
    contratos: ["CRI-01"],
    fonte: "Termo de securitização do CRI",
  },
];

export interface Waiver {
  covenantId: CovenantId;
  apuracao: string; // data-base da medição descumprida
  obtidoEm: string;
  credor: string;
  descricao: string;
}

export const WAIVERS: Waiver[] = [
  {
    covenantId: "icsd",
    apuracao: "2025-12-31",
    obtidoEm: "2026-01-20",
    credor: "BNDES",
    descricao:
      "Anuência do BNDES dispensando o vencimento antecipado pelo ICSD do exercício de 2025, formalizada após a data do balanço.",
  },
];
