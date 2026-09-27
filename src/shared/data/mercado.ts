/**
 * Premissas gerais de mercado – importadas do SAP (ambiente de teste Dexterity).
 *
 * Os valores reproduzem a aba "Premissas" da planilha base (data-base 31/03/2026). Até a data-base usa-se a série
 * histórica importada; depois dela, os valores são projetados com o último dado disponível (taxa constante).
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
    ipca12m: 0.045,
    tjlp: 0.087,
    tlpReal: 0.075,
    baseDiasCorridos: 365,
    baseDiasUteis: 252,
  };
}
