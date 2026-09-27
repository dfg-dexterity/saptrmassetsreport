import { CalendarRange, ClipboardCheck, Coins, Database, FileText, Landmark, Scale, SlidersHorizontal, Waypoints } from "lucide-react";
import type { SecaoProduto } from "../../shared/context/ProdutoContext";
import type { MapeamentoCampo, MapeamentoRelatorio, RelatorioBase } from "../../shared/data/relatorio";

/** Espelho da seção 8 do "Índice" (Captações financeiras – dívida) + parametrização e base técnica */

export const SECOES_CAPTACOES: SecaoProduto[] = [
  { id: "parametrizacao", numero: 1, titulo: "Parametrização e base de dados" },
  { id: "posicao", numero: 2, titulo: "Carteira e vencimentos" },
  { id: "movimentacao", numero: 3, titulo: "Movimentação e custo da dívida" },
  { id: "covenants", numero: 4, titulo: "Covenants" },
  { id: "fechamento", numero: 5, titulo: "Fechamento e nota explicativa" },
  { id: "tecnica", numero: 6, titulo: "Base técnica (CDS Views SAP)" },
];

export const RELATORIOS_CAPTACOES: RelatorioBase[] = [
  {
    id: "premissas",
    codigo: "PAR",
    aba: "Premissas – Premissas de captação (dívida)",
    titulo: "Premissas – Captações",
    tituloCurto: "Premissas",
    descricao:
      "Premissas gerais importadas do SAP: data-base, data de abertura do período, CDI, IPCA, TJLP, TLP e base de dias dos encargos; indexadores da dívida e custo médio ponderado calculado da carteira.",
    publico: "Tesouraria / Controladoria",
    periodicidade: "Mensal",
    norma: "—",
    secao: "parametrizacao",
    rota: "/premissas",
    icone: SlidersHorizontal,
    cor: "#556b82",
  },
  {
    id: "c00",
    codigo: "C00",
    aba: "C00-Carteira-Divida",
    titulo: "C00 – Carteira de captações",
    tituloCurto: "Carteira de Captações",
    descricao:
      "Base de contratos: BNDES FINEM/FINAME (direto e indireto), debêntures (inclusive incentivadas), CRA, CRI e CCB; termos, garantias, covenants, saldo pelo custo amortizado, circulante × não circulante e custo efetivo.",
    publico: "Tesouraria / Contabilidade",
    periodicidade: "Mensal",
    norma: "CPC 48 / CPC 40",
    secao: "posicao",
    rota: "/c00-carteira",
    icone: Landmark,
    cor: "#0070f2",
  },
  {
    id: "c02",
    codigo: "C02",
    aba: "C02-Cronograma",
    titulo: "C02 – Vencimentos e CP/LP",
    tituloCurto: "Vencimentos e CP/LP",
    descricao: "Perfil de amortização por contrato, cronograma do não circulante por ano e parcela circulante.",
    publico: "Tesouraria / Contabilidade",
    periodicidade: "Mensal",
    norma: "CPC 26",
    secao: "posicao",
    rota: "/c02-cronograma",
    icone: CalendarRange,
    cor: "#8b47d7",
  },
  {
    id: "c01",
    codigo: "C01",
    aba: "C01-Movimentacao",
    titulo: "C01 – Movimentação",
    tituloCurto: "Movimentação da Dívida",
    descricao:
      "Saldo de abertura, captações, custos de transação, juros, atualização monetária, apropriação de custos, pagamentos e saldo final; reconciliação com a DFC.",
    publico: "Tesouraria / Contabilidade",
    periodicidade: "Mensal / Trimestral",
    norma: "CPC 03 (item 44A)",
    secao: "movimentacao",
    rota: "/c01-movimentacao",
    icone: Waypoints,
    cor: "#049f9a",
  },
  {
    id: "c03",
    codigo: "C03",
    aba: "C03-Encargos",
    titulo: "C03 – Encargos e custo da dívida",
    tituloCurto: "Encargos e Custo da Dívida",
    descricao:
      "Encargos do período, encargos capitalizados (CPC 20), despesa financeira e custo médio ponderado (alimenta as Premissas e os covenants).",
    publico: "Tesouraria / Controladoria",
    periodicidade: "Mensal",
    norma: "CPC 20 / CPC 48",
    secao: "movimentacao",
    rota: "/c03-encargos",
    icone: Coins,
    cor: "#c87b00",
  },
  {
    id: "c04",
    codigo: "C04",
    aba: "C04-Covenants",
    titulo: "C04 – Covenants",
    tituloCurto: "Covenants",
    descricao:
      "DL/EBITDA, ICSD, índice de capitalização, EBITDA/encargos financeiros e (DL + imóveis)/PL: folga, status, waiver e reclassificação para o circulante.",
    publico: "Tesouraria / RI / Diretoria",
    periodicidade: "Trimestral / Anual",
    norma: "CPC 26 / escrituras",
    secao: "covenants",
    rota: "/c04-covenants",
    icone: Scale,
    cor: "#df1278",
  },
  {
    id: "c05",
    codigo: "C05",
    aba: "C05-Fechamento",
    titulo: "C05 – Fechamento e conciliação",
    tituloCurto: "Fechamento e Conciliação",
    descricao:
      "TRM × FI-GL por conta, TRM × extratos (BNDES, agente fiduciário, securitizadora), checagens de integridade e checklist SAP (TBB1, TPM44, TPM1).",
    publico: "Contabilidade / Controladoria / Auditoria",
    periodicidade: "Mensal (DU-2 a DU+3)",
    norma: "—",
    secao: "fechamento",
    rota: "/c05-fechamento",
    icone: ClipboardCheck,
    cor: "#256f3a",
  },
  {
    id: "c06",
    codigo: "C06",
    aba: "C06-NE-Captacoes",
    titulo: "C06 – Nota explicativa de captações",
    tituloCurto: "Nota Explicativa de Captações",
    descricao:
      "Composição, movimentação, vencimentos do não circulante, características de debêntures/CRA/CRI/BNDES, custos de transação, covenants e textos.",
    publico: "Contabilidade / Auditoria / RI",
    periodicidade: "Trimestral / Anual",
    norma: "CPC 21 / CPC 26 / CPC 40 / CPC 48",
    secao: "fechamento",
    rota: "/c06-nota-explicativa",
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
      "CDS Views do SAP TRM/FI usadas como fonte dos relatórios de captação: campos (tabela/campo base, elemento de dados, domínio), domínios e dependências.",
    publico: "Time técnico",
    periodicidade: "Referência",
    norma: "SAP S/4HANA – VDM",
    secao: "tecnica",
    rota: "/cds",
    icone: Database,
    cor: "#5d36ff",
  },
];

export function relatorioCaptacao(id: string): RelatorioBase {
  const r = RELATORIOS_CAPTACOES.find((x) => x.id === id);
  if (!r) throw new Error(`Relatório ${id} não encontrado`);
  return r;
}

/** C00 × campos das CDS Views (Debt and Investment Management) */
export const MAPEAMENTO_C00: MapeamentoCampo[] = [
  { id: "C01", coluna: "Empresa", visao: "IFINTRAN", campo: "COMPANYCODE" },
  { id: "C02", coluna: "Transação", visao: "IFINTRAN", campo: "FINANCIALTRANSACTION" },
  { id: "C03", coluna: "Credor", visao: "IFINTRAN", campo: "COUNTERPARTY" },
  { id: "C04", coluna: "Garantidor / avalista", visao: "IFINTRAN", campo: "FINANCIALINSTRUMENTGUARANTOR" },
  { id: "C05", coluna: "Modalidade (tipo de produto)", visao: "IFINTRAN", campo: "FINANCIALINSTRUMENTPRODUCTTYPE" },
  { id: "C06", coluna: "Categoria de produto", visao: "IFINTRAN", campo: "FINANCIALINSTRPRODUCTCATEGORY" },
  { id: "C07", coluna: "Linha de crédito (BNDES)", visao: "IFINTRAN", campo: "TREASURYFACILITY" },
  { id: "C08", coluna: "Data de captação", visao: "IFINTRAN", campo: "TERMSTARTDATE" },
  { id: "C09", coluna: "Vencimento", visao: "IFINTRAN", campo: "TERMENDDATE" },
  { id: "C10", coluna: "Moeda", visao: "IFINTRAN", campo: "TRANSACTIONCURRENCY" },
  { id: "C11", coluna: "Indexador", visao: "IFINTRSMANAGE", campo: "INTERESTREFERENCE" },
  { id: "C12", coluna: "Spread / taxa", visao: "IFINTRANSCNDN", campo: "FINANCIALCONDITIONPAYMENTRATE" },
  { id: "C13", coluna: "Valor captado", visao: "IFINTRSMANAGE", campo: "FINTRANSFLOWNOMAMT" },
  { id: "C14", coluna: "Portfolio", visao: "IFINTRAN", campo: "PORTFOLIO" },
  { id: "C15", coluna: "Classe de avaliação", visao: "IFINTRAN", campo: "TREASURYVALUATIONCLASS" },
  { id: "C16", coluna: "Saldo pelo custo amortizado", visao: null, campo: null, regra: "Principal atualizado + juros a pagar − custos de transação a apropriar" },
  { id: "C17", coluna: "Circulante × não circulante", visao: null, campo: null, regra: "Principal com vencimento em até 12 meses + juros a pagar − custos do período (CPC 26)" },
  { id: "C18", coluna: "Custo efetivo (CET)", visao: null, campo: null, regra: "TIR dos fluxos: captação líquida de custos × pagamentos projetados com o último dado disponível" },
];

/** C02 × Maturity Profile */
export const MAPEAMENTO_C02: MapeamentoCampo[] = [
  { id: "V01", coluna: "Fluxos futuros (principal e juros)", visao: "CMATPROFILEQ", campo: null, regra: "Query View for Maturity Profile" },
  { id: "V02", coluna: "Posição por transação", visao: "CFINPOSQ", campo: null, regra: "Financial Position Query" },
  { id: "V03", coluna: "Status da transação", visao: "CFINTRANSSITN", campo: null, regra: "Financial Transaction Situation" },
  { id: "V04", coluna: "Montantes por data", visao: "CTRANAMTSGLQRY", campo: null, regra: "Fin. Trans. Amount on Single Date – Query" },
  { id: "V05", coluna: "Utilização da linha de crédito", visao: "IFACUTILIZATION", campo: null, regra: "Treasury Facility Utilization" },
];

export const MAPEAMENTOS_CAPTACOES: MapeamentoRelatorio[] = [
  { id: "c00", titulo: "Mapeamento C00 – Carteira de captações", subtitulo: "Colunas da carteira × campos das CDS Views", linhas: MAPEAMENTO_C00 },
  { id: "c02", titulo: "Mapeamento C02 – Vencimentos e CP/LP", subtitulo: "Fontes do cronograma e da posição", linhas: MAPEAMENTO_C02 },
];
