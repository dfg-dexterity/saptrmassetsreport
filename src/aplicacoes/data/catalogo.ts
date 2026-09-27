import type { MapeamentoCampo, MapeamentoRelatorio, RelatorioBase } from "../../shared/data/relatorio";
import {
  SlidersHorizontal,
  Table2,
  PieChart,
  LineChart,
  TrendingUp,
  Hourglass,
  Scale,
  FileText,
  Database,
  Target,
  Layers,
  Landmark,
  Globe2,
  Grid3x3,
  Coins,
  ClipboardCheck,
  Gauge,
} from "lucide-react";

/** Espelho da aba "Índice" do Reporting Pack de Aplicações Financeiras */

export type SecaoId =
  | "parametrizacao"
  | "posicao"
  | "movimentacao"
  | "rentabilidade"
  | "indicadores"
  | "fechamento"
  | "notas"
  | "tecnica";

export interface Secao {
  id: SecaoId;
  numero: number;
  titulo: string;
}

export const SECOES: Secao[] = [
  { id: "parametrizacao", numero: 1, titulo: "Parametrização e base de dados" },
  { id: "posicao", numero: 2, titulo: "Posição" },
  { id: "movimentacao", numero: 3, titulo: "Movimentação e evolução" },
  { id: "rentabilidade", numero: 4, titulo: "Rentabilidade e eficiência fiscal" },
  { id: "indicadores", numero: 5, titulo: "Indicadores (KPIs)" },
  { id: "fechamento", numero: 6, titulo: "Fechamento e conciliação" },
  { id: "notas", numero: 7, titulo: "Notas explicativas" },
  { id: "tecnica", numero: 8, titulo: "Base técnica (CDS Views SAP)" },
];

export type Relatorio = RelatorioBase;

export const RELATORIOS: Relatorio[] = [
  {
    id: "premissas",
    codigo: "PAR",
    aba: "Premissas",
    titulo: "Premissas – Parâmetros gerais",
    tituloCurto: "Premissas",
    descricao:
      "Premissas gerais importadas do SAP (CDI, Selic, IPCA e PTAX USD/EUR), data-base escolhida pelo usuário, custo médio da dívida (calculado da carteira de captações), tabelas regressivas de IRRF e IOF, custódia de títulos, VNA, come-cotas e parâmetros de time deposit. Alimentam todos os relatórios.",
    publico: "Tesouraria / Controladoria",
    periodicidade: "Mensal",
    norma: "Lei 11.033/2004 · Decreto 6.306/2007",
    secao: "parametrizacao",
    rota: "/premissas",
    icone: SlidersHorizontal,
    cor: "#00b3ac",
  },
  {
    id: "benchmark",
    codigo: "BMK",
    aba: "Premissas – cadastro de benchmark",
    titulo: "Benchmark de rentabilidade",
    tituloCurto: "Benchmark (% do CDI)",
    descricao:
      "Cadastro das taxas de benchmark em percentual do CDI por carteira, empresa, portfolio ou tipo de produto (inclusive títulos públicos, fundos e time deposits). Usadas no R01, R03, R05 e R09 para comparar a rentabilidade de cada aplicação.",
    publico: "Tesouraria / Comitê de investimentos",
    periodicidade: "Sob demanda",
    norma: "Política de investimentos",
    secao: "parametrizacao",
    rota: "/benchmark",
    icone: Target,
    cor: "#00b3ac",
  },
  {
    id: "mestre",
    codigo: "CM",
    aba: "Carteira-Mestre",
    titulo: "Carteira-Mestre – Base consolidada de contratos",
    tituloCurto: "Carteira-Mestre",
    descricao:
      "Todos os contratos (renda fixa bancária, Tesouro Direto, fundos, time deposits) padronizados em R$: curva, mercado, MTM, rendimentos, tributos, taxas, valor contábil e grupo econômico. Alimenta R02, R03 (consolidado), R05–R07, R11, R12 e os KPIs.",
    publico: "Tesouraria / Time técnico",
    periodicidade: "Diária / Mensal",
    norma: "CPC 48",
    secao: "parametrizacao",
    rota: "/carteira-mestre",
    icone: Layers,
    cor: "#00b3ac",
  },
  {
    id: "r01",
    codigo: "R01",
    aba: "DD-31",
    titulo: "R01 – Composição detalhada",
    tituloCurto: "Composição Detalhada",
    descricao:
      "Carteira de renda fixa bancária por operação: contraparte, produto, indexador, taxa, datas, principal, juros, IR, saldo líquido, valor justo e classificação CPC 48.",
    publico: "Tesouraria / Contabilidade",
    periodicidade: "Diária / Mensal",
    norma: "CPC 48",
    secao: "posicao",
    rota: "/r01-composicao",
    icone: Table2,
    cor: "#00b3ac",
  },
  {
    id: "r08",
    codigo: "R08",
    aba: "R08-Tesouro",
    titulo: "R08 – Tesouro Direto",
    tituloCurto: "Tesouro Direto",
    descricao:
      "LFT, LTN, NTN-F, NTN-B Principal e NTN-B: PU e valor na curva × a mercado, MTM, cupons, custódia, taxa do agente, IOF/IRRF e valor contábil.",
    publico: "Tesouraria / Contabilidade",
    periodicidade: "Diária / Mensal",
    norma: "CPC 48 / CPC 40 (R1)",
    secao: "posicao",
    rota: "/r08-tesouro",
    icone: Landmark,
    cor: "#00b3ac",
  },
  {
    id: "r10",
    codigo: "R10",
    aba: "R10-TimeDeposit",
    titulo: "R10 – Time deposits",
    tituloCurto: "Time Deposits",
    descricao:
      "Depósitos no exterior (USD/EUR): juros em moeda original, PTAX, variação cambial acumulada e do mês, IOF câmbio, tarifas e resultado em R$.",
    publico: "Tesouraria / Contabilidade / Fiscal",
    periodicidade: "Mensal",
    norma: "CPC 02 / CPC 03",
    secao: "posicao",
    rota: "/r10-time-deposit",
    icone: Globe2,
    cor: "#00b3ac",
  },
  {
    id: "r11",
    codigo: "R11",
    aba: "R11-Moeda-Tipo",
    titulo: "R11 – Moeda × tipo de contrato",
    tituloCurto: "Moeda × Tipo de Contrato",
    descricao:
      "Matriz da carteira por moeda × tipo de contrato em R$ e em moeda original; curva × mercado e resultado por moeda.",
    publico: "Tesouraria / Diretoria / Risco",
    periodicidade: "Mensal",
    norma: "CPC 02 / CPC 40 (R1)",
    secao: "posicao",
    rota: "/r11-moeda-tipo",
    icone: Grid3x3,
    cor: "#00b3ac",
  },
  {
    id: "r07",
    codigo: "R07",
    aba: "R07-Concentracao",
    titulo: "R07 – Concentração da carteira",
    tituloCurto: "Concentração da Carteira",
    descricao:
      "Exposição por grupo econômico (limite e rating), tipo de contrato, indexador, moeda e prazo; índice HHI e semáforo de enquadramento na política.",
    publico: "Tesouraria / Risco / Comitê",
    periodicidade: "Mensal",
    norma: "Política de investimentos",
    secao: "posicao",
    rota: "/r07-concentracao",
    icone: PieChart,
    cor: "#00b3ac",
  },
  {
    id: "r05",
    codigo: "R05",
    aba: "R05-Evolucao",
    titulo: "R05 – Evolução mensal",
    tituloCurto: "Evolução Mensal",
    descricao:
      "Saldo inicial, aplicações, resgates, rendimentos, IRRF/IOF e saldo final em 12 meses, % do CDI e gráfico; saldo final conciliado com a Carteira-Mestre.",
    publico: "Tesouraria / Diretoria Financeira",
    periodicidade: "Mensal",
    norma: "—",
    secao: "movimentacao",
    rota: "/r05-evolucao",
    icone: LineChart,
    cor: "#00b3ac",
  },
  {
    id: "r03",
    codigo: "R03",
    aba: "R03-Rentab",
    titulo: "R03 – Rentabilidade realizada e real",
    tituloCurto: "Rentabilidade Realizada e Real",
    descricao:
      "Rendimento bruto, IOF, IRRF, líquido, % do CDI e rentabilidade real (descontado o IPCA) por contrato de renda fixa bancária e consolidado por tipo de contrato.",
    publico: "Tesouraria / Diretoria Financeira",
    periodicidade: "Mensal",
    norma: "—",
    secao: "rentabilidade",
    rota: "/r03-rentabilidade",
    icone: TrendingUp,
    cor: "#00b3ac",
  },
  {
    id: "r04",
    codigo: "R04",
    aba: "R04-Prazo-Fiscal",
    titulo: "R04 – Eficiência fiscal por prazo",
    tituloCurto: "Eficiência Fiscal por Prazo",
    descricao:
      "Faixa atual do IRRF regressivo, dias até a próxima faixa, economia de IR ao aguardar e recomendação de resgate; simulação de carga tributária por prazo.",
    publico: "Tesouraria",
    periodicidade: "Semanal / Sob demanda",
    norma: "—",
    secao: "rentabilidade",
    rota: "/r04-prazo-fiscal",
    icone: Hourglass,
    cor: "#00b3ac",
  },
  {
    id: "r09",
    codigo: "R09",
    aba: "R09-Fundos",
    titulo: "R09 – Fundos e come-cotas",
    tituloCurto: "Fundos e Come-cotas",
    descricao:
      "Fundos RF, crédito privado, multimercado, ações e cambial: taxas adm./perf., come-cotas (mai/nov), IR complementar e custo do come-cotas na rentabilidade.",
    publico: "Tesouraria / Diretoria Financeira",
    periodicidade: "Mensal",
    norma: "CPC 48",
    secao: "rentabilidade",
    rota: "/r09-fundos",
    icone: Coins,
    cor: "#00b3ac",
  },
  {
    id: "kpis",
    codigo: "KPI",
    aba: "Painel de KPIs",
    titulo: "Painel de KPIs – Aplicações financeiras",
    tituloCurto: "Painel de KPIs",
    descricao:
      "Indicadores-chave da carteira consolidada em um só lugar: saldo, rentabilidade × CDI e benchmark, liquidez imediata, duration, concentração (HHI e maior grupo), exposição cambial, carga tributária, carry e enquadramento na política, com metas, tendência de 12 meses e semáforo.",
    publico: "Diretoria Financeira / Comitê de investimentos",
    periodicidade: "Diária / Mensal",
    norma: "Política de investimentos",
    secao: "indicadores",
    rota: "/kpis",
    icone: Gauge,
    cor: "#00b3ac",
  },
  {
    id: "r06",
    codigo: "R06",
    aba: "R06-Indicadores",
    titulo: "R06 – Endividamento × Aplicações",
    tituloCurto: "Endividamento × Aplicações",
    descricao:
      "Dívida bruta e líquida na data-base, covenants contratuais da dívida (com efeito CPC 26), limites da política financeira (cobertura de curto prazo, DL/PL), série trimestral e carry (rentabilidade das aplicações − custo da dívida).",
    publico: "Diretoria Financeira / Conselho / RI",
    periodicidade: "Mensal / Trimestral",
    norma: "Covenants",
    secao: "indicadores",
    rota: "/r06-indicadores",
    icone: Scale,
    cor: "#00b3ac",
  },
  {
    id: "r12",
    codigo: "R12",
    aba: "R12-Conciliacao",
    titulo: "R12 – Conciliação de fim de mês",
    tituloCurto: "Conciliação de Fim de Mês",
    descricao:
      "TRM × FI-GL × extratos por tipo de contrato e por conta contábil, roll-forward do saldo e checklist de fechamento (TBB1, TPM44, TPM1 e TPM10 – fixar/lançar operações da gestão de posições).",
    publico: "Contabilidade / Controladoria / Auditoria",
    periodicidade: "Mensal (DU-1 a DU+3)",
    norma: "CPC 48 · controles internos",
    secao: "fechamento",
    rota: "/r12-conciliacao",
    icone: ClipboardCheck,
    cor: "#00b3ac",
  },
  {
    id: "r02",
    codigo: "R02",
    aba: "DD-32",
    titulo: "R02 – Movimentação (nota explicativa)",
    tituloCurto: "Movimentação – Nota Explicativa",
    descricao:
      "Quadro de movimentação das aplicações (saldo inicial, aplicações, resgates, rendimentos, IRRF, come-cotas, saldo final) – Controladora e Consolidado – e composição por tipo de contrato.",
    publico: "Contabilidade / Auditoria / RI",
    periodicidade: "Trimestral / Anual",
    norma: "CPC 40 (R1) / CPC 48",
    secao: "notas",
    rota: "/r02-movimentacao",
    icone: FileText,
    cor: "#00b3ac",
  },
  {
    id: "cds",
    codigo: "CDS",
    aba: "Lista de CDS · DD27VVT · Domínios · DDLDEPENDENCY",
    titulo: "Catálogo de CDS Views",
    tituloCurto: "Catálogo de CDS Views",
    descricao:
      "CDS Views do SAP TRM/FI usadas como fonte dos relatórios: campos (tabela/campo base, elemento de dados, domínio), domínios e dependências.",
    publico: "Time técnico",
    periodicidade: "Referência",
    norma: "SAP S/4HANA – VDM",
    secao: "tecnica",
    rota: "/cds",
    icone: Database,
    cor: "#00b3ac",
  },
];

export function relatorioPorId(id: string): Relatorio {
  const r = RELATORIOS.find((x) => x.id === id);
  if (!r) throw new Error(`Relatório ${id} não encontrado`);
  return r;
}

/** Mapeamento das colunas do R01 (aba DD-31) para os campos das CDS Views */
export const MAPEAMENTO_R01: MapeamentoCampo[] = [
  { id: "ID01", coluna: "Empresa", visao: "IFINTRAN", campo: "COMPANYCODE" },
  { id: "ID02", coluna: "Transação", visao: "IFINTRAN", campo: "FINANCIALTRANSACTION" },
  { id: "ID03", coluna: "Parceiro de Negócio", visao: "IFINTRAN", campo: "COUNTERPARTY" },
  { id: "ID04", coluna: "Tipo de Produto", visao: "IFINTRAN", campo: "FINANCIALINSTRUMENTPRODUCTTYPE" },
  { id: "ID05", coluna: "Indexador", visao: "IFINTRSMANAGE", campo: "INTERESTREFERENCE" },
  { id: "ID06", coluna: "Taxa Contratada", visao: "IFINTRANSCNDN", campo: "FINANCIALCONDITIONPAYMENTRATE" },
  { id: "ID08", coluna: "Portfolio", visao: "IFINTRAN", campo: "PORTFOLIO" },
  { id: "ID09", coluna: "Calendário", visao: "IFINTRAN", campo: "FINTRANSFACTORYCALENDAR1" },
  { id: "ID10", coluna: "Data Aplicação", visao: "IFINTRAN", campo: "TERMSTARTDATE" },
  { id: "ID11", coluna: "Data Vencimento", visao: "IFINTRAN", campo: "TERMENDDATE" },
  { id: "ID12", coluna: "Valor Principal", visao: "IFINTRSMANAGE", campo: "FINTRANSFLOWNOMAMT" },
  { id: "ID13", coluna: "Juros Provisionados", visao: null, campo: null, regra: "Principal × (fator do indexador − 1), apropriado até a data-base" },
  { id: "ID14", coluna: "IR s/ Rendimento", visao: null, campo: null, regra: "(Juros − IOF) × alíquota da tabela regressiva (Premissas)" },
  { id: "ID15", coluna: "Valor Líquido", visao: null, campo: null, regra: "Principal + Juros − IR − IOF" },
  { id: "ID16", coluna: "Valor Justo (R$)", visao: null, campo: null, regra: "Valor na curva ajustado a mercado (marcação a mercado)" },
  { id: "ID17", coluna: "Classificação CPC 48", visao: null, campo: null, regra: "Derivada da classe geral de avaliação (IFINTRAN.TREASURYVALUATIONCLASS)" },
];

export const MAPEAMENTOS_APLICACOES: MapeamentoRelatorio[] = [
  {
    id: "r01",
    titulo: "Mapeamento R01 – Composição detalhada",
    subtitulo: "Colunas do relatório (aba DD-31) × campos das CDS Views",
    linhas: MAPEAMENTO_R01,
  },
];
