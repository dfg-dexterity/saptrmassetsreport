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
} from "lucide-react";

/** Espelho da aba "Índice" do Reporting Pack de Aplicações Financeiras */

export type SecaoId = "parametrizacao" | "posicao" | "movimentacao" | "rentabilidade" | "indicadores" | "notas" | "tecnica";

export interface Secao {
  id: SecaoId;
  numero: number;
  titulo: string;
}

export const SECOES: Secao[] = [
  { id: "parametrizacao", numero: 1, titulo: "Parametrização" },
  { id: "posicao", numero: 2, titulo: "Posição" },
  { id: "movimentacao", numero: 3, titulo: "Movimentação e Evolução" },
  { id: "rentabilidade", numero: 4, titulo: "Rentabilidade e Eficiência Fiscal" },
  { id: "indicadores", numero: 5, titulo: "Indicadores (KPIs)" },
  { id: "notas", numero: 6, titulo: "Notas Explicativas" },
  { id: "tecnica", numero: 7, titulo: "Base Técnica (CDS Views SAP)" },
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
      "Premissas gerais importadas do SAP (CDI, Selic e IPCA), data-base escolhida pelo usuário, custo médio da dívida (calculado da carteira de captações) e tabelas regressivas de IRRF e IOF. Alimentam todos os relatórios.",
    publico: "Tesouraria / Controladoria",
    periodicidade: "Mensal",
    norma: "Lei 11.033/2004 · Decreto 6.306/2007",
    secao: "parametrizacao",
    rota: "/premissas",
    icone: SlidersHorizontal,
    cor: "#556b82",
  },
  {
    id: "benchmark",
    codigo: "BMK",
    aba: "Premissas – cadastro de benchmark",
    titulo: "Benchmark de rentabilidade",
    tituloCurto: "Benchmark (% do CDI)",
    descricao:
      "Cadastro das taxas de benchmark em percentual do CDI por carteira, empresa, portfolio ou tipo de produto. Usadas no R01, R03 e R05 para comparar a rentabilidade de cada aplicação.",
    publico: "Tesouraria / Comitê de investimentos",
    periodicidade: "Sob demanda",
    norma: "Política de investimentos",
    secao: "parametrizacao",
    rota: "/benchmark",
    icone: Target,
    cor: "#049f9a",
  },
  {
    id: "r01",
    codigo: "R01",
    aba: "DD-31",
    titulo: "R01 – Composição detalhada",
    tituloCurto: "Composição Detalhada",
    descricao:
      "Carteira aberta por operação: contraparte, produto, indexador, taxa, datas, principal, juros, IR, saldo líquido, valor justo e classificação CPC 48.",
    publico: "Tesouraria / Contabilidade",
    periodicidade: "Diária / Mensal",
    norma: "CPC 48",
    secao: "posicao",
    rota: "/r01-composicao",
    icone: Table2,
    cor: "#0070f2",
  },
  {
    id: "r07",
    codigo: "R07",
    aba: "R07-Concentracao",
    titulo: "R07 – Concentração da carteira",
    tituloCurto: "Concentração da Carteira",
    descricao:
      "Exposição por contraparte (limite por banco), produto, indexador e prazo; índice HHI e semáforo de enquadramento na política.",
    publico: "Tesouraria / Risco / Comitê",
    periodicidade: "Mensal",
    norma: "Política de investimentos",
    secao: "posicao",
    rota: "/r07-concentracao",
    icone: PieChart,
    cor: "#8b47d7",
  },
  {
    id: "r05",
    codigo: "R05",
    aba: "R05-Evolucao",
    titulo: "R05 – Evolução mensal",
    tituloCurto: "Evolução Mensal",
    descricao:
      "Saldo inicial, aplicações, resgates, rendimentos, IRRF/IOF e saldo final mês a mês (12 meses), % do CDI e gráfico; conciliado com o R03.",
    publico: "Tesouraria / Diretoria Financeira",
    periodicidade: "Mensal",
    norma: "—",
    secao: "movimentacao",
    rota: "/r05-evolucao",
    icone: LineChart,
    cor: "#049f9a",
  },
  {
    id: "r03",
    codigo: "R03",
    aba: "R03-Rentab",
    titulo: "R03 – Rentabilidade realizada e real",
    tituloCurto: "Rentabilidade Realizada e Real",
    descricao:
      "Rendimento bruto, IOF, IRRF, rendimento líquido, % do CDI bruto e líquido e rentabilidade real (descontado o IPCA) por aplicação e da carteira.",
    publico: "Tesouraria / Diretoria Financeira",
    periodicidade: "Mensal",
    norma: "—",
    secao: "rentabilidade",
    rota: "/r03-rentabilidade",
    icone: TrendingUp,
    cor: "#256f3a",
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
    cor: "#c87b00",
  },
  {
    id: "r06",
    codigo: "R06",
    aba: "R06-Indicadores",
    titulo: "R06 – Endividamento × Aplicações",
    tituloCurto: "Endividamento × Aplicações",
    descricao:
      "Dívida bruta e líquida na data-base, covenants contratuais da dívida (com efeito CPC 26), limites da política financeira (liquidez CP, DL/PL), série trimestral e carry (rentabilidade das aplicações − custo da dívida).",
    publico: "Diretoria Financeira / Conselho / RI",
    periodicidade: "Mensal / Trimestral",
    norma: "Covenants",
    secao: "indicadores",
    rota: "/r06-indicadores",
    icone: Scale,
    cor: "#df1278",
  },
  {
    id: "r02",
    codigo: "R02",
    aba: "DD-32",
    titulo: "R02 – Movimentação (nota explicativa)",
    tituloCurto: "Movimentação – Nota Explicativa",
    descricao:
      "Quadro de movimentação das aplicações (saldo inicial, aplicações, resgates, rendimentos, IRRF, saldo final) – Controladora e Consolidado – e composição por tipo.",
    publico: "Contabilidade / Auditoria / RI",
    periodicidade: "Trimestral / Anual",
    norma: "CPC 40 / CPC 48 / CVM 475",
    secao: "notas",
    rota: "/r02-movimentacao",
    icone: FileText,
    cor: "#1d2d3e",
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
    cor: "#5d36ff",
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
