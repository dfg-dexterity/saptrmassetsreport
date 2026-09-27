/**
 * Cadastro de benchmark de rentabilidade (aplicações financeiras), em percentual do CDI.
 * A regra mais específica vence: tipo de produto > portfolio > empresa > carteira.
 */

export type EscopoBenchmark = "carteira" | "empresa" | "portfolio" | "produto";

export interface Benchmark {
  id: string;
  descricao: string;
  /** fração do CDI (1,02 = 102% do CDI) */
  pctCDI: number;
  escopo: EscopoBenchmark;
  /** código da empresa, nome do portfolio ou tipo de produto (vazio para a carteira) */
  valor: string;
  vigenciaInicio: string; // ISO
  /** justificativa da regra (opcional, exibida no cadastro) */
  nota?: string;
}

export const ESCOPOS_BENCHMARK: { value: EscopoBenchmark; label: string; prioridade: number }[] = [
  { value: "produto", label: "Tipo de produto", prioridade: 4 },
  { value: "portfolio", label: "Portfolio", prioridade: 3 },
  { value: "empresa", label: "Empresa", prioridade: 2 },
  { value: "carteira", label: "Carteira consolidada", prioridade: 1 },
];

export const BENCHMARKS_PADRAO: Benchmark[] = [
  { id: "bmk-carteira", descricao: "Benchmark da carteira", pctCDI: 1.0, escopo: "carteira", valor: "", vigenciaInicio: "2022-01-01" },
  { id: "bmk-fundos", descricao: "Fundos DI e renda fixa", pctCDI: 1.02, escopo: "produto", valor: "Fundo RF", vigenciaInicio: "2022-01-01" },
  { id: "bmk-liquidez", descricao: "Caixa de liquidez imediata", pctCDI: 0.95, escopo: "portfolio", valor: "TES-LIQUIDEZ", vigenciaInicio: "2022-01-01" },
  { id: "bmk-credito", descricao: "Crédito privado indexado ao IPCA", pctCDI: 0.8, escopo: "portfolio", valor: "TES-CREDITO", vigenciaInicio: "2022-01-01" },
  { id: "bmk-letras", descricao: "Letras de crédito do agronegócio", pctCDI: 0.9, escopo: "produto", valor: "LCA", vigenciaInicio: "2022-01-01" },
  { id: "bmk-lci", descricao: "Letras de crédito imobiliário", pctCDI: 0.9, escopo: "produto", valor: "LCI", vigenciaInicio: "2022-01-01" },
  {
    id: "bmk-soberano",
    descricao: "Títulos públicos federais",
    pctCDI: 1.0,
    escopo: "portfolio",
    valor: "TES-SOBERANO",
    vigenciaInicio: "2022-01-01",
    nota: "Risco soberano: LFT, LTN, NTN-F e NTN-B comparadas ao CDI pelo valor na curva (MTM fora da comparação).",
  },
  {
    id: "bmk-exterior",
    descricao: "Aplicações no exterior (time deposits)",
    pctCDI: 0.6,
    escopo: "portfolio",
    valor: "TES-EXTERIOR",
    vigenciaInicio: "2022-01-01",
    nota:
      "Custo de oportunidade em R$: o time deposit é hedge natural de passivo em moeda estrangeira; o resultado em R$ (juros em USD/EUR + variação cambial) é comparado a 60% do CDI.",
  },
  {
    id: "bmk-credito-fundos",
    descricao: "Fundos de crédito privado",
    pctCDI: 1.05,
    escopo: "produto",
    valor: "Fundo crédito privado",
    vigenciaInicio: "2022-01-01",
    nota: "Prêmio de crédito esperado sobre o CDI (prevalece sobre a regra do portfolio TES-CREDITO).",
  },
];

export const PCT_MINIMO = 0.5;
export const PCT_MAXIMO = 2.0;
