/**
 * Base do R06 – Endividamento × Aplicações (dados fictícios para demonstração).
 * A composição da dívida segue o modelo do relatório "03 – Empréstimos e Financiamentos".
 */

export interface Divida {
  modalidade: string;
  moeda: "BRL" | "USD";
  indexador: string;
  taxa: string;
  garantia: string;
  vencimento: string; // ISO
  circulante: number;
  naoCirculante: number;
}

export const DIVIDAS: Divida[] = [
  { modalidade: "Capital de Giro", moeda: "BRL", indexador: "CDI", taxa: "CDI + 2,50% a.a.", garantia: "Aval", vencimento: "2026-09-30", circulante: 10_000_000, naoCirculante: 0 },
  { modalidade: "BNDES – Finame", moeda: "BRL", indexador: "TLP", taxa: "TLP + 1,80% a.a.", garantia: "Equipamento", vencimento: "2030-12-15", circulante: 2_400_000, naoCirculante: 9_600_000 },
  { modalidade: "Res. 4.131 (swap p/ CDI)", moeda: "USD", indexador: "SOFR", taxa: "SOFR + 3,00% a.a.", garantia: "Aval", vencimento: "2028-06-30", circulante: 0, naoCirculante: 30_000_000 },
  { modalidade: "Debênture 1ª Emissão", moeda: "BRL", indexador: "CDI", taxa: "CDI + 1,50% a.a.", garantia: "Quirografária", vencimento: "2029-09-15", circulante: 4_000_000, naoCirculante: 36_000_000 },
  { modalidade: "NCE", moeda: "BRL", indexador: "CDI", taxa: "CDI + 2,00% a.a.", garantia: "Recebíveis", vencimento: "2027-04-30", circulante: 6_000_000, naoCirculante: 12_000_000 },
  { modalidade: "Arrendamento (CPC 06)", moeda: "BRL", indexador: "IPCA", taxa: "IPCA + 5,00% a.a.", garantia: "Imóvel", vencimento: "2034-12-31", circulante: 1_600_000, naoCirculante: 14_400_000 },
  { modalidade: "ACC/ACE", moeda: "USD", indexador: "Pré", taxa: "4,50% a.a. (USD)", garantia: "Exportação", vencimento: "2026-09-30", circulante: 16_000_000, naoCirculante: 0 },
];

export interface Trimestre {
  data: string; // fim do trimestre (ISO)
  dividaBruta: number;
  dividaCP: number;
  caixa: number; // disponibilidades (bancos conta movimento)
  ebitdaLTM: number;
  jurosLTM: number; // despesa de juros da dívida – últimos 12 meses
  patrimonioLiquido: number;
}

export const TRIMESTRES: Trimestre[] = [
  { data: "2025-03-31", dividaBruta: 150_000_000, dividaCP: 34_000_000, caixa: 5_100_000, ebitdaLTM: 54_000_000, jurosLTM: 20_100_000, patrimonioLiquido: 286_000_000 },
  { data: "2025-06-30", dividaBruta: 148_000_000, dividaCP: 36_000_000, caixa: 3_800_000, ebitdaLTM: 56_500_000, jurosLTM: 21_600_000, patrimonioLiquido: 292_000_000 },
  { data: "2025-09-30", dividaBruta: 146_000_000, dividaCP: 38_000_000, caixa: 4_600_000, ebitdaLTM: 58_200_000, jurosLTM: 22_800_000, patrimonioLiquido: 299_000_000 },
  { data: "2025-12-31", dividaBruta: 144_000_000, dividaCP: 41_000_000, caixa: 6_200_000, ebitdaLTM: 60_400_000, jurosLTM: 23_400_000, patrimonioLiquido: 305_000_000 },
  { data: "2026-03-31", dividaBruta: 142_000_000, dividaCP: 40_000_000, caixa: 4_200_000, ebitdaLTM: 62_000_000, jurosLTM: 23_700_000, patrimonioLiquido: 311_000_000 },
];

export interface Covenant {
  id: "dlEbitda" | "cobertura" | "liquidez" | "dlPl";
  indicador: string;
  tipo: "max" | "min";
  limite: number;
  alerta: number; // faixa de atenção
  fonte: string;
}

export const COVENANTS: Covenant[] = [
  { id: "dlEbitda", indicador: "Dívida líquida / EBITDA", tipo: "max", limite: 3.0, alerta: 2.5, fonte: "Escritura da 1ª emissão de debêntures" },
  { id: "cobertura", indicador: "EBITDA / Despesa de juros", tipo: "min", limite: 2.0, alerta: 2.5, fonte: "Contrato NCE" },
  { id: "liquidez", indicador: "Liquidez de curto prazo", tipo: "min", limite: 1.0, alerta: 1.2, fonte: "Política financeira interna" },
  { id: "dlPl", indicador: "Dívida líquida / PL", tipo: "max", limite: 1.0, alerta: 0.8, fonte: "Política financeira interna" },
];
