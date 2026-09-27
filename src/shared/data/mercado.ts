/**
 * Premissas gerais de mercado – importadas do SAP (ambiente de teste Dexterity).
 *
 * Os valores reproduzem a aba "Premissas" da planilha base (data-base 31/03/2026). Até a data-base usa-se a série
 * histórica importada (CDI, IPCA, TJLP e TLP); depois dela, os valores são projetados com o último dado disponível (taxa constante).
 */

export const AVISO_DADOS =
  "Os dados a seguir são fictícios, do nosso ambiente de teste. As premissas gerais são importadas do SAP e os valores são projetados usando o último dado disponível.";

export interface PremissasMercado {
  dataBase: string; // ISO
  cdi: number; // a.a. (fração) – último CDI disponível até a data-base
  selic: number;
  ipca12m: number;
  tjlp: number; // BNDES FINEM
  tlpReal: number; // BNDES FINAME: TLP = IPCA + taxa real
  baseDiasCorridos: number;
  baseDiasUteis: number;
  /** PTAX venda (BCB) do fim do mês da data-base – TCURR tipo M */
  ptaxUSD: number;
  ptaxEUR: number;
}

/** Compatibilidade com o motor de Aplicações */
export type Premissas = PremissasMercado;

export const DATA_BASE_PADRAO = "2026-03-31";

/** Metadados da última importação de dados de mercado do SAP (ambiente de teste) */
export const IMPORTACAO_SAP = {
  sistema: "SAP S/4HANA – ambiente de teste Dexterity",
  ultimaImportacao: "2026-03-31T19:05:00",
  ultimoDadoDisponivel: "2026-03-31",
};

/** Último dado de mercado disponível do ponto de vista da data-base (datas-base anteriores projetam a partir delas mesmas) */
export function ultimoDadoNaDataBase(dataBase: string): string {
  return dataBase < IMPORTACAO_SAP.ultimoDadoDisponivel ? dataBase : IMPORTACAO_SAP.ultimoDadoDisponivel;
}

export interface FonteParametro {
  parametro: string;
  fonte: string;
}

/** Origem de cada premissa geral no SAP (views de dados de mercado do catálogo de CDS) */
export const FONTES_SAP: Record<string, string> = {
  cdi: "Dados de mercado SAP – taxa de referência CDI (CMKTREFINTQUERY)",
  selic: "Dados de mercado SAP – taxa de referência Selic (CMKTREFINTQUERY)",
  ipca12m: "Dados de mercado SAP – índice IPCA acumulado 12 meses",
  tjlp: "Dados de mercado SAP – TJLP (CMN/BCB, fixada trimestralmente)",
  tlpReal: "Dados de mercado SAP – TLP taxa real prefixada (BCB, mensal)",
  ptaxUSD: "Dados de mercado SAP – câmbio PTAX venda BCB (TCURR, tipo M)",
  ptaxEUR: "Dados de mercado SAP – câmbio PTAX venda BCB (TCURR, tipo M)",
  baseDiasCorridos: "Constante",
  baseDiasUteis: "Constante (dias úteis ANBIMA)",
};

/**
 * CDI médio mensal (% a.a.) importado do SAP. Meses posteriores à data-base usam o último valor disponível.
 */
export const CDI_MENSAL: Record<string, number> = {
  "2022-01": 0.0915,
  "2022-02": 0.1065,
  "2022-03": 0.1165,
  "2022-04": 0.1165,
  "2022-05": 0.1265,
  "2022-06": 0.1315,
  "2022-07": 0.1315,
  "2022-08": 0.1365,
  "2022-09": 0.1365,
  "2022-10": 0.1365,
  "2022-11": 0.1365,
  "2022-12": 0.1365,
  "2023-01": 0.1365,
  "2023-02": 0.1365,
  "2023-03": 0.1365,
  "2023-04": 0.1365,
  "2023-05": 0.1365,
  "2023-06": 0.1365,
  "2023-07": 0.1365,
  "2023-08": 0.1315,
  "2023-09": 0.1265,
  "2023-10": 0.1265,
  "2023-11": 0.1215,
  "2023-12": 0.1165,
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

export const PRIMEIRO_MES_CDI = "2022-01";
export const ULTIMO_MES_CDI = "2026-03";

/** IPCA acumulado em 12 meses no mês (fração) importado do SAP – usado como taxa anual de correção no mês */
export const IPCA_12M_MENSAL: Record<string, number> = {
  "2022-01": 0.1038,
  "2022-02": 0.1054,
  "2022-03": 0.113,
  "2022-04": 0.1213,
  "2022-05": 0.1173,
  "2022-06": 0.1189,
  "2022-07": 0.1007,
  "2022-08": 0.0873,
  "2022-09": 0.0717,
  "2022-10": 0.0647,
  "2022-11": 0.059,
  "2022-12": 0.0579,
  "2023-01": 0.0577,
  "2023-02": 0.056,
  "2023-03": 0.0465,
  "2023-04": 0.0418,
  "2023-05": 0.0394,
  "2023-06": 0.0316,
  "2023-07": 0.0399,
  "2023-08": 0.0461,
  "2023-09": 0.0519,
  "2023-10": 0.0482,
  "2023-11": 0.0468,
  "2023-12": 0.0462,
  "2024-01": 0.0451,
  "2024-02": 0.045,
  "2024-03": 0.0393,
  "2024-04": 0.0369,
  "2024-05": 0.0393,
  "2024-06": 0.0423,
  "2024-07": 0.045,
  "2024-08": 0.0424,
  "2024-09": 0.0442,
  "2024-10": 0.0476,
  "2024-11": 0.0487,
  "2024-12": 0.0483,
  "2025-01": 0.0456,
  "2025-02": 0.0506,
  "2025-03": 0.0548,
  "2025-04": 0.0553,
  "2025-05": 0.0532,
  "2025-06": 0.0535,
  "2025-07": 0.0523,
  "2025-08": 0.0513,
  "2025-09": 0.0517,
  "2025-10": 0.0468,
  "2025-11": 0.0446,
  "2025-12": 0.0426,
  "2026-01": 0.0444,
  "2026-02": 0.0452,
  "2026-03": 0.045,
};

/** TJLP a.a. vigente no mês (fixada trimestralmente pelo CMN) importada do SAP */
export const TJLP_MENSAL: Record<string, number> = {
  "2022-01": 0.0608,
  "2022-02": 0.0608,
  "2022-03": 0.0608,
  "2022-04": 0.0682,
  "2022-05": 0.0682,
  "2022-06": 0.0682,
  "2022-07": 0.0701,
  "2022-08": 0.0701,
  "2022-09": 0.0701,
  "2022-10": 0.072,
  "2022-11": 0.072,
  "2022-12": 0.072,
  "2023-01": 0.0737,
  "2023-02": 0.0737,
  "2023-03": 0.0737,
  "2023-04": 0.0728,
  "2023-05": 0.0728,
  "2023-06": 0.0728,
  "2023-07": 0.07,
  "2023-08": 0.07,
  "2023-09": 0.07,
  "2023-10": 0.0655,
  "2023-11": 0.0655,
  "2023-12": 0.0655,
  "2024-01": 0.0653,
  "2024-02": 0.0653,
  "2024-03": 0.0653,
  "2024-04": 0.0667,
  "2024-05": 0.0667,
  "2024-06": 0.0667,
  "2024-07": 0.0691,
  "2024-08": 0.0691,
  "2024-09": 0.0691,
  "2024-10": 0.0743,
  "2024-11": 0.0743,
  "2024-12": 0.0743,
  "2025-01": 0.0797,
  "2025-02": 0.0797,
  "2025-03": 0.0797,
  "2025-04": 0.0837,
  "2025-05": 0.0837,
  "2025-06": 0.0837,
  "2025-07": 0.0864,
  "2025-08": 0.0864,
  "2025-09": 0.0864,
  "2025-10": 0.0857,
  "2025-11": 0.0857,
  "2025-12": 0.0857,
  "2026-01": 0.087,
  "2026-02": 0.087,
  "2026-03": 0.087,
};

/** TLP – taxa real prefixada a.a. do mês (BCB) importada do SAP; fixada no contrato na data da contratação */
export const TLP_REAL_MENSAL: Record<string, number> = {
  "2022-01": 0.0441,
  "2022-02": 0.0455,
  "2022-03": 0.047,
  "2022-04": 0.0502,
  "2022-05": 0.0521,
  "2022-06": 0.0537,
  "2022-07": 0.0564,
  "2022-08": 0.0587,
  "2022-09": 0.0593,
  "2022-10": 0.0578,
  "2022-11": 0.0565,
  "2022-12": 0.0566,
  "2023-01": 0.0592,
  "2023-02": 0.0605,
  "2023-03": 0.0587,
  "2023-04": 0.0563,
  "2023-05": 0.0542,
  "2023-06": 0.0503,
  "2023-07": 0.0498,
  "2023-08": 0.0495,
  "2023-09": 0.051,
  "2023-10": 0.0561,
  "2023-11": 0.055,
  "2023-12": 0.0512,
  "2024-01": 0.05,
  "2024-02": 0.0509,
  "2024-03": 0.0516,
  "2024-04": 0.054,
  "2024-05": 0.057,
  "2024-06": 0.061,
  "2024-07": 0.0623,
  "2024-08": 0.0612,
  "2024-09": 0.062,
  "2024-10": 0.0647,
  "2024-11": 0.068,
  "2024-12": 0.072,
  "2025-01": 0.074,
  "2025-02": 0.0745,
  "2025-03": 0.0732,
  "2025-04": 0.0728,
  "2025-05": 0.0735,
  "2025-06": 0.074,
  "2025-07": 0.0742,
  "2025-08": 0.0739,
  "2025-09": 0.0745,
  "2025-10": 0.075,
  "2025-11": 0.0747,
  "2025-12": 0.0746,
  "2026-01": 0.0748,
  "2026-02": 0.0752,
  "2026-03": 0.075,
};

/** Valor de uma série mensal no mês `mes` (AAAA-MM), limitado ao primeiro e ao último mês disponíveis */
export function valorDoMes(serie: Record<string, number>, mes: string): number {
  if (mes < PRIMEIRO_MES_CDI) return serie[PRIMEIRO_MES_CDI];
  if (mes > ULTIMO_MES_CDI) return serie[ULTIMO_MES_CDI];
  return serie[mes] ?? serie[ULTIMO_MES_CDI];
}

/** PTAX venda (BCB) do último dia útil de cada mês, importada do SAP (TCURR tipo M) – R$ por unidade de moeda */
export const PTAX_MENSAL: Record<"USD" | "EUR", Record<string, number>> = {
  USD: {
    "2024-06": 5.5589,
    "2024-07": 5.7131,
    "2024-08": 5.6554,
    "2024-09": 5.4481,
    "2024-10": 5.668,
    "2024-11": 5.7885,
    "2024-12": 6.1923,
    "2025-01": 5.835,
    "2025-02": 5.8528,
    "2025-03": 5.7422,
    "2025-04": 5.6624,
    "2025-05": 5.67,
    "2025-06": 5.4571,
    "2025-07": 5.6036,
    "2025-08": 5.4288,
    "2025-09": 5.3276,
    "2025-10": 5.38,
    "2025-11": 5.395,
    "2025-12": 5.496,
    "2026-01": 5.471,
    "2026-02": 5.518,
    "2026-03": 5.452,
  },
  EUR: {
    "2024-06": 5.9547,
    "2024-07": 6.1882,
    "2024-08": 6.2596,
    "2024-09": 6.066,
    "2024-10": 6.145,
    "2024-11": 6.115,
    "2024-12": 6.4363,
    "2025-01": 6.0708,
    "2025-02": 6.0842,
    "2025-03": 6.2069,
    "2025-04": 6.4239,
    "2025-05": 6.4313,
    "2025-06": 6.4171,
    "2025-07": 6.3974,
    "2025-08": 6.3368,
    "2025-09": 6.2553,
    "2025-10": 6.128,
    "2025-11": 6.105,
    "2025-12": 6.118,
    "2026-01": 6.052,
    "2026-02": 5.987,
    "2026-03": 5.924,
  },
};

export const PRIMEIRO_MES_PTAX = "2024-06";
export const ULTIMO_MES_PTAX = "2026-03";

/** PTAX de fim de mês (limitada ao primeiro e ao último mês importados) */
export function ptaxDoMes(moeda: "USD" | "EUR", mes: string): number {
  const serie = PTAX_MENSAL[moeda];
  if (mes < PRIMEIRO_MES_PTAX) return serie[PRIMEIRO_MES_PTAX];
  if (mes > ULTIMO_MES_PTAX) return serie[ULTIMO_MES_PTAX];
  return serie[mes];
}

/** Último CDI disponível até o mês da data-base */
export function ultimoCDI(dataBase: string): number {
  let mes = dataBase.slice(0, 7);
  if (mes > ULTIMO_MES_CDI) mes = ULTIMO_MES_CDI;
  return CDI_MENSAL[mes] ?? CDI_MENSAL[ULTIMO_MES_CDI];
}

/** Premissas gerais vigentes na data-base (importadas do SAP) */
export function premissasNaDataBase(dataBase: string): PremissasMercado {
  const cdi = ultimoCDI(dataBase);
  return {
    dataBase,
    cdi,
    selic: Math.round((cdi + 0.001) * 10000) / 10000,
    ipca12m: valorDoMes(IPCA_12M_MENSAL, dataBase.slice(0, 7)),
    tjlp: valorDoMes(TJLP_MENSAL, dataBase.slice(0, 7)),
    tlpReal: valorDoMes(TLP_REAL_MENSAL, dataBase.slice(0, 7)),
    baseDiasCorridos: 365,
    baseDiasUteis: 252,
    ptaxUSD: ptaxDoMes("USD", dataBase.slice(0, 7)),
    ptaxEUR: ptaxDoMes("EUR", dataBase.slice(0, 7)),
  };
}
