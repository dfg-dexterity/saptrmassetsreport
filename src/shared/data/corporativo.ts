/**
 * Dados corporativos do ambiente de teste (fictícios), usados nos indicadores de endividamento (R06) e na
 * apuração de covenants (C04). Dívida e aplicações vêm dos motores de cálculo; aqui ficam apenas os números que
 * viriam da contabilidade/controladoria (EBITDA, PL, ativo, caixa).
 */

export interface DadosCorporativos {
  data: string; // fim do trimestre (ISO)
  caixa: number; // disponibilidades (bancos conta movimento)
  ebitdaLTM: number;
  patrimonioLiquido: number;
  ativoTotal: number;
  imoveisAPagar: number; // obrigações por aquisição de imóveis
}

export const DADOS_CORPORATIVOS: DadosCorporativos[] = [
  { data: "2024-12-31", caixa: 4_400_000, ebitdaLTM: 52_000_000, patrimonioLiquido: 280_000_000, ativoTotal: 800_000_000, imoveisAPagar: 9_000_000 },
  { data: "2025-03-31", caixa: 5_100_000, ebitdaLTM: 54_000_000, patrimonioLiquido: 286_000_000, ativoTotal: 815_000_000, imoveisAPagar: 8_600_000 },
  { data: "2025-06-30", caixa: 3_800_000, ebitdaLTM: 56_500_000, patrimonioLiquido: 292_000_000, ativoTotal: 840_000_000, imoveisAPagar: 8_200_000 },
  { data: "2025-09-30", caixa: 4_600_000, ebitdaLTM: 58_200_000, patrimonioLiquido: 299_000_000, ativoTotal: 856_000_000, imoveisAPagar: 7_800_000 },
  { data: "2025-12-31", caixa: 6_200_000, ebitdaLTM: 60_400_000, patrimonioLiquido: 305_000_000, ativoTotal: 872_000_000, imoveisAPagar: 7_400_000 },
  { data: "2026-03-31", caixa: 4_200_000, ebitdaLTM: 62_000_000, patrimonioLiquido: 311_000_000, ativoTotal: 895_000_000, imoveisAPagar: 7_000_000 },
];

/** Geração de caixa para o serviço da dívida (numerador do ICSD – BNDES), por exercício */
export const GERACAO_CAIXA_ICSD: Record<number, number> = {
  2024: 8_000_000,
  2025: 19_800_000,
};

export function dadosCorporativosAte(data: string): DadosCorporativos[] {
  return DADOS_CORPORATIVOS.filter((d) => d.data <= data);
}
