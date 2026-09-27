import { addMonths, proximoDiaUtil } from "../../shared/lib/dates";

/**
 * C00 – Carteira de captações (dados fictícios do ambiente de teste).
 * BNDES FINEM/FINAME (direto e indireto), debêntures (inclusive incentivadas), CRA, CRI e CCB, com termos,
 * garantias e covenants. Contratos liquidados antes da data-base alimentam a movimentação (C01).
 */

export type Modalidade = "Debênture" | "Debênture incentivada" | "CRA" | "CRI" | "BNDES FINEM" | "BNDES FINAME" | "CCB";
export type IndexadorDivida = "CDI" | "IPCA" | "TJLP" | "TLP" | "Pré";

export interface Amortizacao {
  data: string;
  /** fração do valor captado (nominal) */
  pct: number;
}

export interface ContratoDivida {
  id: string;
  transacao: string; // IFINTRAN.FINANCIALTRANSACTION
  empresa: string; // IFINTRAN.COMPANYCODE
  modalidade: Modalidade;
  instrumento: string;
  credor: string; // IFINTRAN.COUNTERPARTY
  agente: string | null; // agente fiduciário, securitizadora ou agente financeiro (BNDES indireto)
  formaBNDES?: "Direto" | "Indireto";
  indexador: IndexadorDivida; // IFINTRSMANAGE.INTERESTREFERENCE
  /** spread a.a. (exponencial) – IFINTRANSCNDN.FINANCIALCONDITIONPAYMENTRATE */
  spread: number;
  /** spread do agente financeiro (BNDES indireto) */
  spreadAgente?: number;
  dataCaptacao: string; // IFINTRAN.TERMSTARTDATE
  vencimento: string; // IFINTRAN.TERMENDDATE
  valorCaptado: number; // IFINTRSMANAGE.FINTRANSFLOWNOMAMT
  custosTransacao: number;
  amortizacoes: Amortizacao[];
  datasJuros: string[];
  descricaoAmortizacao: string;
  descricaoJuros: string;
  garantias: string;
  covenants: string[];
  finalidade: string;
  lastro?: string;
  /** Juros capitalizados em ativo qualificável (CPC 20) até a data */
  capitalizacaoCPC20?: { ate: string; ativo: string };
  portfolio: string; // IFINTRAN.PORTFOLIO
  linhaCredito?: string; // IFINTRAN.TREASURYFACILITY
}

/** Nomes das empresas (atalho) */
export const EMPRESAS_DIVIDA: Record<string, string> = {
  "1000": "Empresa ABC S.A.",
  "2000": "ABC Logística Ltda.",
  "3000": "ABC Energia S.A.",
};

/** n parcelas iguais a cada `meses`, a partir de `primeira` */
function parcelas(primeira: string, n: number, meses: number): Amortizacao[] {
  const out: Amortizacao[] = [];
  for (let i = 0; i < n; i++) out.push({ data: addMonths(primeira, i * meses), pct: 1 / n });
  return out;
}

/** Datas a cada `meses` de `primeira` até `ultima` (inclusive) */
function periodicas(primeira: string, ultima: string, meses: number): string[] {
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const d = addMonths(primeira, i * meses);
    if (d > ultima) break;
    out.push(d);
  }
  if (out[out.length - 1] !== ultima) out.push(ultima);
  return out;
}

function unir(...listas: string[][]): string[] {
  return [...new Set(listas.flat())].sort();
}

/**
 * Datas contratuais que caem em fim de semana ou feriado são pagas no dia útil seguinte (calendário BR, como o SAP faz
 * com o calendário de fábrica da transação).
 */
function ajustarDiasUteis(c: ContratoDivida): ContratoDivida {
  const amort = new Map<string, number>();
  for (const a of c.amortizacoes) {
    const d = proximoDiaUtil(a.data);
    amort.set(d, (amort.get(d) ?? 0) + a.pct);
  }
  const vencimento = proximoDiaUtil(c.vencimento);
  return {
    ...c,
    vencimento,
    amortizacoes: [...amort.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([data, pct]) => ({ data, pct })),
    datasJuros: [...new Set(c.datasJuros.map(proximoDiaUtil))].sort(),
  };
}

const CONTRATOS_BASE: ContratoDivida[] = [
  {
    id: "DEB-01",
    transacao: "50000112",
    empresa: "1000",
    modalidade: "Debênture",
    instrumento: "1ª emissão de debêntures simples – série única",
    credor: "Debenturistas",
    agente: "Trust Alfa DTVM (agente fiduciário)",
    indexador: "CDI",
    spread: 0.015,
    dataCaptacao: "2024-09-16",
    vencimento: "2029-09-17",
    valorCaptado: 40_000_000,
    custosTransacao: 1_100_000,
    amortizacoes: [
      { data: "2028-09-17", pct: 0.5 },
      { data: "2029-09-17", pct: 0.5 },
    ],
    datasJuros: periodicas("2025-03-17", "2029-09-17", 6),
    descricaoAmortizacao: "2 parcelas anuais (set/2028 e set/2029)",
    descricaoJuros: "Semestrais (mar/set)",
    garantias: "Quirografária",
    covenants: ["dlEbitda"],
    finalidade: "Alongamento do perfil da dívida e reforço de capital de giro",
    portfolio: "TES-DIVIDA",
  },
  {
    id: "DEB-02",
    transacao: "50000187",
    empresa: "3000",
    modalidade: "Debênture incentivada",
    instrumento: "1ª emissão de debêntures incentivadas (Lei 12.431) – série única",
    credor: "Debenturistas",
    agente: "Trust Alfa DTVM (agente fiduciário)",
    indexador: "IPCA",
    spread: 0.062,
    dataCaptacao: "2025-06-16",
    vencimento: "2035-06-15",
    valorCaptado: 20_000_000,
    custosTransacao: 700_000,
    amortizacoes: parcelas("2031-06-15", 5, 12),
    datasJuros: periodicas("2025-12-15", "2035-06-15", 6),
    descricaoAmortizacao: "5 parcelas anuais a partir de jun/2031",
    descricaoJuros: "Semestrais (jun/dez)",
    garantias: "Cessão fiduciária dos recebíveis do contrato de energia (PPA) e alienação fiduciária das ações da SPE",
    covenants: ["ebitdaDespFin"],
    finalidade: "Projeto de infraestrutura – parque solar (Lei 12.431)",
    capitalizacaoCPC20: { ate: "2026-06-30", ativo: "Imobilizado em andamento – parque solar" },
    portfolio: "TES-DIVIDA",
  },
  {
    id: "DEB-03",
    transacao: "50000241",
    empresa: "1000",
    modalidade: "Debênture",
    instrumento: "2ª emissão de debêntures simples – série única",
    credor: "Debenturistas",
    agente: "Trust Alfa DTVM (agente fiduciário)",
    indexador: "CDI",
    spread: 0.0125,
    dataCaptacao: "2026-02-20",
    vencimento: "2031-02-20",
    valorCaptado: 25_000_000,
    custosTransacao: 600_000,
    amortizacoes: parcelas("2029-02-20", 3, 12),
    datasJuros: periodicas("2026-08-20", "2031-02-20", 6),
    descricaoAmortizacao: "3 parcelas anuais a partir de fev/2029",
    descricaoJuros: "Semestrais (fev/ago)",
    garantias: "Quirografária",
    covenants: ["dlEbitda"],
    finalidade: "Alongamento do perfil da dívida e investimentos em armazenagem",
    portfolio: "TES-DIVIDA",
  },
  {
    id: "CRA-01",
    transacao: "50000098",
    empresa: "1000",
    modalidade: "CRA",
    instrumento: "CRA – 12ª emissão, série única (Agro Securitizadora Beta)",
    credor: "Titulares de CRA",
    agente: "Agro Securitizadora Beta (securitizadora)",
    indexador: "IPCA",
    spread: 0.059,
    dataCaptacao: "2024-04-15",
    vencimento: "2030-04-15",
    valorCaptado: 10_000_000,
    custosTransacao: 450_000,
    amortizacoes: [
      { data: "2029-04-15", pct: 0.5 },
      { data: "2030-04-15", pct: 0.5 },
    ],
    datasJuros: periodicas("2024-10-15", "2030-04-15", 6),
    descricaoAmortizacao: "2 parcelas anuais (abr/2029 e abr/2030)",
    descricaoJuros: "Semestrais (abr/out)",
    garantias: "Sem garantia real",
    lastro: "CDCA emitido pela Empresa ABC (compra de grãos de produtores rurais)",
    covenants: ["ebitdaDespFin"],
    finalidade: "Financiamento da originação de grãos",
    portfolio: "TES-DIVIDA",
  },
  {
    id: "CRA-02",
    transacao: "50000203",
    empresa: "1000",
    modalidade: "CRA",
    instrumento: "CRA – 19ª emissão, série DI (Agro Securitizadora Beta)",
    credor: "Titulares de CRA",
    agente: "Agro Securitizadora Beta (securitizadora)",
    indexador: "CDI",
    spread: 0.0095,
    dataCaptacao: "2025-08-20",
    vencimento: "2028-08-21",
    valorCaptado: 12_000_000,
    custosTransacao: 360_000,
    amortizacoes: [{ data: "2028-08-21", pct: 1 }],
    datasJuros: periodicas("2026-02-20", "2028-02-20", 6).concat("2028-08-21"),
    descricaoAmortizacao: "Bullet (ago/2028)",
    descricaoJuros: "Semestrais (fev/ago)",
    garantias: "Sem garantia real",
    lastro: "CDCA emitido pela Empresa ABC (insumos agrícolas)",
    covenants: ["ebitdaDespFin"],
    finalidade: "Capital de giro da operação agrícola",
    portfolio: "TES-DIVIDA",
  },
  {
    id: "CRI-01",
    transacao: "50000071",
    empresa: "1000",
    modalidade: "CRI",
    instrumento: "CRI – 7ª emissão, série única (Securitizadora Imobiliária Gama)",
    credor: "Titulares de CRI",
    agente: "Securitizadora Imobiliária Gama (securitizadora)",
    indexador: "IPCA",
    spread: 0.065,
    dataCaptacao: "2023-11-10",
    vencimento: "2033-11-10",
    valorCaptado: 9_000_000,
    custosTransacao: 380_000,
    amortizacoes: parcelas("2026-05-10", 16, 6),
    datasJuros: periodicas("2024-05-10", "2033-11-10", 6),
    descricaoAmortizacao: "16 parcelas semestrais a partir de mai/2026",
    descricaoJuros: "Semestrais (mai/nov)",
    garantias: "Alienação fiduciária do centro de distribuição e cessão dos recebíveis de locação",
    lastro: "Contrato built-to-suit do centro de distribuição",
    covenants: ["dlImoveisPl"],
    finalidade: "Construção do centro de distribuição",
    portfolio: "TES-DIVIDA",
  },
  {
    id: "BND-01",
    transacao: "50000034",
    empresa: "1000",
    modalidade: "BNDES FINEM",
    instrumento: "BNDES FINEM – direto (Subcrédito A)",
    credor: "BNDES",
    agente: null,
    formaBNDES: "Direto",
    indexador: "TJLP",
    spread: 0.021,
    dataCaptacao: "2022-10-17",
    vencimento: "2030-10-15",
    valorCaptado: 12_000_000,
    custosTransacao: 90_000,
    amortizacoes: parcelas("2024-11-15", 72, 1),
    datasJuros: unir(periodicas("2023-01-16", "2024-10-15", 3), periodicas("2024-11-15", "2030-10-15", 1)),
    descricaoAmortizacao: "72 parcelas mensais (SAC) após 24 meses de carência",
    descricaoJuros: "Trimestrais na carência, mensais na amortização",
    garantias: "Hipoteca da planta industrial e fiança bancária",
    covenants: ["icsd", "capitalizacao"],
    finalidade: "Ampliação da unidade de esmagamento",
    portfolio: "TES-DIVIDA",
    linhaCredito: "BNDES-2022-A",
  },
  {
    id: "BND-02",
    transacao: "50000089",
    empresa: "3000",
    modalidade: "BNDES FINEM",
    instrumento: "BNDES FINEM – indireto (agente: Banco do Brasil)",
    credor: "BNDES",
    agente: "Banco do Brasil (agente financeiro)",
    formaBNDES: "Indireto",
    indexador: "TJLP",
    spread: 0.018,
    spreadAgente: 0.015,
    dataCaptacao: "2024-03-20",
    vencimento: "2034-03-15",
    valorCaptado: 15_000_000,
    custosTransacao: 120_000,
    amortizacoes: parcelas("2026-10-15", 90, 1),
    datasJuros: unir(periodicas("2024-06-17", "2026-09-15", 3), periodicas("2026-10-15", "2034-03-15", 1)),
    descricaoAmortizacao: "90 parcelas mensais (SAC) a partir de out/2026",
    descricaoJuros: "Trimestrais na carência, mensais na amortização",
    garantias: "Penhor dos equipamentos e fiança da controladora",
    covenants: ["icsd", "capitalizacao"],
    finalidade: "Implantação do parque solar (ativo qualificável)",
    capitalizacaoCPC20: { ate: "2026-06-30", ativo: "Imobilizado em andamento – parque solar" },
    portfolio: "TES-DIVIDA",
    linhaCredito: "BNDES-2024-B",
  },
  {
    id: "BND-03",
    transacao: "50000151",
    empresa: "2000",
    modalidade: "BNDES FINAME",
    instrumento: "BNDES FINAME – indireto (agente: Banco Bradesco)",
    credor: "BNDES",
    agente: "Banco Bradesco (agente financeiro)",
    formaBNDES: "Indireto",
    indexador: "TLP",
    spread: 0.009,
    spreadAgente: 0.005,
    dataCaptacao: "2025-02-10",
    vencimento: "2031-02-17",
    valorCaptado: 6_000_000,
    custosTransacao: 45_000,
    amortizacoes: parcelas("2026-03-17", 60, 1),
    datasJuros: unir(periodicas("2025-05-12", "2026-02-10", 3), periodicas("2026-03-17", "2031-02-17", 1)),
    descricaoAmortizacao: "60 parcelas mensais (SAC) após 12 meses de carência",
    descricaoJuros: "Trimestrais na carência, mensais na amortização",
    garantias: "Alienação fiduciária dos caminhões e implementos",
    covenants: [],
    finalidade: "Renovação da frota rodoviária",
    portfolio: "TES-DIVIDA",
    linhaCredito: "FINAME-2025",
  },
  {
    id: "CCB-01",
    transacao: "50000139",
    empresa: "1000",
    modalidade: "CCB",
    instrumento: "Cédula de Crédito Bancário nº 7731",
    credor: "Banco Itaú",
    agente: null,
    indexador: "CDI",
    spread: 0.019,
    dataCaptacao: "2025-03-10",
    vencimento: "2028-03-10",
    valorCaptado: 10_000_000,
    custosTransacao: 150_000,
    amortizacoes: parcelas("2025-09-10", 6, 6),
    datasJuros: periodicas("2025-09-10", "2028-03-10", 6),
    descricaoAmortizacao: "6 parcelas semestrais",
    descricaoJuros: "Semestrais, com a amortização",
    garantias: "Aval da ABC Logística e cessão fiduciária de 20% dos recebíveis",
    covenants: ["dlEbitda"],
    finalidade: "Capital de giro",
    portfolio: "TES-DIVIDA",
  },
  {
    id: "CCB-02",
    transacao: "50000104",
    empresa: "2000",
    modalidade: "CCB",
    instrumento: "Cédula de Crédito Bancário nº 55.210",
    credor: "Banco Bradesco",
    agente: null,
    indexador: "CDI",
    spread: 0.022,
    dataCaptacao: "2024-11-05",
    vencimento: "2026-11-05",
    valorCaptado: 6_000_000,
    custosTransacao: 90_000,
    amortizacoes: [{ data: "2026-11-05", pct: 1 }],
    datasJuros: periodicas("2025-02-05", "2026-11-05", 3),
    descricaoAmortizacao: "Bullet (nov/2026)",
    descricaoJuros: "Trimestrais",
    garantias: "Aval da controladora",
    covenants: [],
    finalidade: "Capital de giro",
    portfolio: "TES-DIVIDA",
  },
  {
    id: "CCB-03",
    transacao: "50000126",
    empresa: "3000",
    modalidade: "CCB",
    instrumento: "Cédula de Crédito Bancário nº 1.118/2025",
    credor: "Banco Santander",
    agente: null,
    indexador: "CDI",
    spread: 0.024,
    dataCaptacao: "2025-01-15",
    vencimento: "2026-01-15",
    valorCaptado: 5_000_000,
    custosTransacao: 60_000,
    amortizacoes: [{ data: "2026-01-15", pct: 1 }],
    datasJuros: ["2026-01-15"],
    descricaoAmortizacao: "Bullet (jan/2026)",
    descricaoJuros: "No vencimento",
    garantias: "Aval da controladora",
    covenants: [],
    finalidade: "Reforço de capital de giro",
    portfolio: "TES-DIVIDA",
  },
];

export const CONTRATOS: ContratoDivida[] = CONTRATOS_BASE.map(ajustarDiasUteis);

export function contratoPorId(id: string): ContratoDivida {
  const c = CONTRATOS.find((x) => x.id === id);
  if (!c) throw new Error(`Contrato ${id} não encontrado`);
  return c;
}

export function taxaContratadaDivida(c: ContratoDivida): string {
  const pct = (v: number) => (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  switch (c.indexador) {
    case "CDI":
      return `CDI + ${pct(c.spread)}% a.a.`;
    case "IPCA":
      return `IPCA + ${pct(c.spread)}% a.a.`;
    case "TJLP":
      return c.spreadAgente ? `TJLP + ${pct(c.spread)}% + ${pct(c.spreadAgente)}% (agente)` : `TJLP + ${pct(c.spread)}% a.a.`;
    case "TLP":
      return c.spreadAgente ? `TLP + ${pct(c.spread)}% + ${pct(c.spreadAgente)}% (agente)` : `TLP + ${pct(c.spread)}% a.a.`;
    case "Pré":
      return `${pct(c.spread)}% a.a.`;
  }
}

export const GRUPO_MODALIDADE: Record<Modalidade, string> = {
  "Debênture": "Debêntures",
  "Debênture incentivada": "Debêntures",
  CRA: "CRA",
  CRI: "CRI",
  "BNDES FINEM": "BNDES",
  "BNDES FINAME": "BNDES",
  CCB: "CCB",
};
