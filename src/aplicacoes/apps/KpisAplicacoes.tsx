import clsx from "clsx";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight, LayoutGrid, Table2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Card, SectionTitle } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, SegmentedButton, Select } from "../../shared/components/fiori/Inputs";
import { CHART_SEMANTIC, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { KpiCard, type KpiIndicadorLateral, type KpiTendencia } from "../../shared/components/fiori/KpiCard";
import { ObjectStatus, Tag, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { CONTRATOS } from "../../captacoes/data/contratos";
import { reclassificadosEm } from "../../captacoes/lib/covenants";
import { custoMedioPonderado, posicoesDivida } from "../../captacoes/lib/divida";
import { usePremissas } from "../../shared/context/MercadoContext";
import { dadosCorporativosAte } from "../../shared/data/corporativo";
import type { PremissasMercado as Premissas } from "../../shared/data/mercado";
import { addDays, diffDays, fmtDate, fmtMonthShort, fmtQuarter, lastMonthEnds, previousYearEnd } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtCompact, fmtDec, fmtInt, fmtPct } from "../../shared/lib/format";
import { relatorioPorId } from "../data/catalogo";
import type { Benchmark } from "../data/benchmark";
import { FUNDOS, type Fundo } from "../data/fundos";
import { TITULOS } from "../data/tesouro";
import { useBenchmarks } from "../context/BenchmarkContext";
import { ESCOPOS, type Escopo } from "../context/useDados";
import { compararCarteira, situacaoBenchmark, SITUACAO_TEXTO, TOLERANCIA_BENCHMARK, type ComparacaoBenchmark } from "../lib/benchmark";
import {
  contratosMestre,
  evolucaoMestre,
  movimentacaoMestre,
  rentabilidadeMestre,
  TIPOS_CONTRATO,
  type ContratoMestre,
  type RentabContrato,
} from "../lib/carteiraMestre";
import { historicoFundo, posicaoFundo } from "../lib/fundos";
import {
  apurarCovenants,
  avaliarPolitica,
  calcularCarry,
  classificarHHI,
  concentracaoPorGrupo,
  endividamentoEm,
  hhi,
  rotuloCovenant,
  SEMAFORO_TEXTO,
  type GrupoExposicao,
  type ResultadoRegra,
  type Semaforo,
} from "../lib/indicadores";
import { posicaoTitulo } from "../lib/tesouro";

const rel = relatorioPorId("kpis");

// ---------------------------------------------------------------------------
// Definições dos KPIs: fórmula, meta/limite, regra de status, micrográfico e relatório de origem
// ---------------------------------------------------------------------------

type SecaoKpi = "politica" | "resultado" | "rentabilidade" | "liquidez" | "risco" | "custos" | "divida";

const SECOES_KPI: { id: SecaoKpi; numero: number; titulo: string }[] = [
  { id: "politica", numero: 0, titulo: "Política de investimentos" },
  { id: "resultado", numero: 1, titulo: "Tamanho e resultado" },
  { id: "rentabilidade", numero: 2, titulo: "Rentabilidade" },
  { id: "liquidez", numero: 3, titulo: "Liquidez e prazo" },
  { id: "risco", numero: 4, titulo: "Risco e concentração" },
  { id: "custos", numero: 5, titulo: "Custos e tributos" },
  { id: "divida", numero: 6, titulo: "Aplicações × dívida" },
];

type KpiId =
  | "enquadramento"
  | "saldo"
  | "rendBruto"
  | "rendLiquido"
  | "pctBruto"
  | "pctLiquido"
  | "real"
  | "excesso"
  | "liquidez"
  | "prazo"
  | "venc90"
  | "duration"
  | "hhi"
  | "limiteGrupo"
  | "cambial"
  | "credito"
  | "carga"
  | "taxas"
  | "comeCotas"
  | "carry"
  | "dlEbitda"
  | "cobertura";

interface DefinicaoKpi {
  id: KpiId;
  secao: SecaoKpi;
  nome: string;
  /** rótulo curto do scorecard */
  curto: string;
  /** fórmula resumida (subtítulo do cartão) */
  resumo: string;
  /** fórmula completa (tabela, exportação e dica do cartão) */
  formula: string;
  unidade: string;
  /** meta ou limite, por extenso */
  meta: string;
  tipo: "max" | "min";
  /** regra de status (faixa de atenção e fora da meta) */
  regra: string;
  serie: string;
  rota: string;
  origem: string;
  /** sempre consolidado (não segue o filtro de empresa) */
  consolidado?: boolean;
}

/** Parâmetros das metas (política de investimentos, política financeira e metas do comitê – dados fictícios) */
const P = {
  /** reserva mínima de liquidez da política financeira, por escopo */
  reservaMinima: { todas: 50e6, "1000": 35e6, "2000": 5e6, "3000": 10e6 } as Record<string, number>,
  /** faixa de atenção do benchmark (abaixo de −0,5 p.p. até −2,0 p.p.) */
  bmkFora: 0.02,
  /** carga tributária-meta (também deflaciona o benchmark na meta líquida) */
  cargaMax: 0.2,
  cargaAlerta: 0.18,
  realMin: 0.04,
  realAlerta: 0.05,
  prazoMax: 720,
  prazoAlerta: 576,
  venc90Max: 0.3,
  venc90Alerta: 0.24,
  durationMax: 4,
  durationAlerta: 3.2,
  utilMax: 1,
  utilAlerta: 0.8,
  taxasMax: 25,
  taxasAlerta: 20,
  carryMin: -0.015,
  carryAlerta: -0.0075,
  coberturaMin: 1,
  coberturaAlerta: 1.2,
  hhiLimite: 1500,
};

const REGRA_BMK =
  "Na meta: em linha (±0,5 p.p.) ou acima do benchmark · Atenção: até 2,0 p.p. abaixo · Fora: mais de 2,0 p.p. abaixo";

const DEFINICOES: DefinicaoKpi[] = [
  {
    id: "enquadramento",
    secao: "politica",
    nome: "Enquadramento na política",
    curto: "Enquadramento",
    resumo: "Regras e limites por grupo não excedidos",
    formula: "Regras da política de investimentos + limites por grupo econômico (rating) não excedidos ÷ total de regras e limites (R07)",
    unidade: "regras",
    meta: "Todas as regras e limites enquadrados",
    tipo: "min",
    regra: "Na meta: todas enquadradas, nenhuma em atenção · Atenção: alguma ≥ 80% do limite (ou ≤ 120% do mínimo) · Fora: alguma excedida",
    serie: "% de regras e limites enquadrados no fim de cada mês",
    rota: "/r07-concentracao",
    origem: "R07",
  },
  {
    id: "saldo",
    secao: "resultado",
    nome: "Saldo consolidado",
    curto: "Saldo",
    resumo: "Σ saldo bruto: curva, cota e ME × PTAX",
    formula: "Σ saldo bruto dos contratos ativos da Carteira-Mestre: curva (renda fixa e títulos), valor da cota (fundos) e saldo em moeda × PTAX (time deposits)",
    unidade: "R$",
    meta: "≥ reserva mínima de liquidez da política financeira (consolidado R$ 50 mi; 1000: R$ 35 mi; 2000: R$ 5 mi; 3000: R$ 10 mi)",
    tipo: "min",
    regra: "Atenção: até 120% da reserva mínima · Fora: abaixo da reserva mínima",
    serie: "Saldo bruto no fim de cada mês (R$ mi)",
    rota: "/carteira-mestre",
    origem: "CM",
  },
  {
    id: "rendBruto",
    secao: "resultado",
    nome: "Rendimento bruto 12 meses",
    curto: "Rend. bruto",
    resumo: "Σ rendimentos dos últimos 12 meses",
    formula: "Σ rendimentos brutos mensais (saldo final − saldo inicial − aplicações + resgates brutos + come-cotas) dos últimos 12 meses",
    unidade: "R$",
    meta: "≥ rendimento do benchmark cadastrado (% do CDI) sobre o mesmo capital",
    tipo: "min",
    regra: REGRA_BMK,
    serie: "Rendimento bruto de cada mês (R$ mi – R05)",
    rota: "/r05-evolucao",
    origem: "R05",
  },
  {
    id: "rendLiquido",
    secao: "resultado",
    nome: "Rendimento líquido 12 meses",
    curto: "Rend. líquido",
    resumo: "Bruto − IR − IOF − custódia e tarifas",
    formula: "Rendimento bruto − IR − IOF − custódia de títulos e tarifas de time deposits dos últimos 12 meses (taxas dos fundos já estão na cota)",
    unidade: "R$",
    meta: "≥ rendimento do benchmark × (1 − 20% de carga tributária-meta)",
    tipo: "min",
    regra: `${REGRA_BMK} (sobre o % do CDI líquido)`,
    serie: "Rendimento líquido de cada mês (R$ mi)",
    rota: "/r03-rentabilidade",
    origem: "R03",
  },
  {
    id: "pctBruto",
    secao: "rentabilidade",
    nome: "% do CDI bruto 12 meses",
    curto: "% CDI bruto",
    resumo: "Rendimento ÷ (capital base × CDI do período)",
    formula: "Rendimento bruto ÷ Σ (capital base de cada contrato × CDI do período) – mesmo método do R03 e do R05 (coluna 12 meses)",
    unidade: "% do CDI",
    meta: "≥ benchmark da carteira (cadastro BMK, regra vigente em cada dia)",
    tipo: "min",
    regra: REGRA_BMK,
    serie: "% do CDI de cada mês sobre o saldo médio (R05)",
    rota: "/r05-evolucao",
    origem: "R05",
  },
  {
    id: "pctLiquido",
    secao: "rentabilidade",
    nome: "% do CDI líquido 12 meses",
    curto: "% CDI líquido",
    resumo: "Rendimento líquido ÷ (capital base × CDI)",
    formula: "Rendimento líquido (após IR, IOF, custódia e tarifas) ÷ Σ (capital base × CDI do período)",
    unidade: "% do CDI",
    meta: "≥ benchmark × (1 − 20% de carga tributária-meta)",
    tipo: "min",
    regra: REGRA_BMK,
    serie: "% do CDI líquido de cada mês",
    rota: "/r03-rentabilidade",
    origem: "R03",
  },
  {
    id: "real",
    secao: "rentabilidade",
    nome: "Rentabilidade real 12 meses",
    curto: "Real",
    resumo: "Líquida ÷ (1 + IPCA 12m) − 1",
    formula: "(1 + rentabilidade líquida sobre o capital médio) ÷ (1 + IPCA 12 meses importado do SAP) − 1",
    unidade: "% a.a.",
    meta: "≥ 4,0% a.a. acima do IPCA",
    tipo: "min",
    regra: "Atenção: entre 4,0% e 5,0% · Fora: abaixo de 4,0%",
    serie: "Rentabilidade líquida do mês anualizada, descontado o IPCA 12 meses",
    rota: "/r03-rentabilidade",
    origem: "R03",
  },
  {
    id: "excesso",
    secao: "rentabilidade",
    nome: "Excesso sobre o benchmark",
    curto: "Excesso",
    resumo: "Realizado − rendimento do benchmark (12m)",
    formula: "Rendimento realizado − rendimento que o benchmark cadastrado teria gerado sobre o mesmo capital, capitalizado dia a dia (12 meses)",
    unidade: "R$",
    meta: "≥ R$ 0",
    tipo: "min",
    regra: REGRA_BMK,
    serie: "Excesso de cada mês (R$ mil – R05)",
    rota: "/benchmark",
    origem: "BMK",
  },
  {
    id: "liquidez",
    secao: "liquidez",
    nome: "Liquidez imediata",
    curto: "Liquidez",
    resumo: "Resgate em D+0/D+1 ou vencimento ≤ 30 dias",
    formula: "Saldo com liquidez diária/D+1, fundos D+0/D+1 ou vencimento em até 30 dias ÷ saldo bruto (regra da política)",
    unidade: "%",
    meta: "≥ 20% da carteira (política de investimentos)",
    tipo: "min",
    regra: "Atenção: até 24% (120% do mínimo) · Fora: abaixo de 20%",
    serie: "% da carteira no fim de cada mês",
    rota: "/r07-concentracao",
    origem: "R07",
  },
  {
    id: "prazo",
    secao: "liquidez",
    nome: "Prazo médio remanescente",
    curto: "Prazo médio",
    resumo: "Ponderado pelo saldo · contratos com vencimento",
    formula: "Σ (dias até o vencimento × saldo bruto) ÷ Σ saldo bruto – contratos com vencimento (fundos abertos fora do cálculo)",
    unidade: "dias",
    meta: "≤ 720 dias",
    tipo: "max",
    regra: "Atenção: a partir de 576 dias (80% do limite) · Fora: acima de 720 dias",
    serie: "Prazo médio no fim de cada mês (dias)",
    rota: "/carteira-mestre",
    origem: "CM",
  },
  {
    id: "venc90",
    secao: "liquidez",
    nome: "Vencimentos em 90 dias",
    curto: "Venc. 90 dias",
    resumo: "Saldo dos contratos que vencem em até 90 dias",
    formula: "Saldo bruto dos contratos (renda fixa, títulos públicos e time deposits) que vencem nos próximos 90 dias",
    unidade: "R$",
    meta: "≤ 30% da carteira (concentração de vencimentos – risco de reinvestimento)",
    tipo: "max",
    regra: "Atenção: a partir de 24% da carteira · Fora: acima de 30%",
    serie: "Saldo a vencer em 90 dias no fim de cada mês (R$ mi)",
    rota: "/carteira-mestre",
    origem: "CM",
  },
  {
    id: "duration",
    secao: "liquidez",
    nome: "Duration dos títulos públicos",
    curto: "Duration",
    resumo: "Macaulay, ponderada pelo saldo a mercado",
    formula: "Duration de Macaulay (anos úteis) de cada título público ponderada pelo saldo a mercado (taxas indicativas ANBIMA)",
    unidade: "anos",
    meta: "≤ 4,0 anos (risco de mercado)",
    tipo: "max",
    regra: "Atenção: a partir de 3,2 anos · Fora: acima de 4,0 anos",
    serie: "Duration no fim de cada mês (anos)",
    rota: "/r08-tesouro",
    origem: "R08",
  },
  {
    id: "hhi",
    secao: "risco",
    nome: "Concentração por grupo (HHI)",
    curto: "HHI",
    resumo: "Σ participações² por grupo econômico",
    formula: "Índice Herfindahl-Hirschman: Σ (participação de cada grupo econômico em %)², de 0 a 10.000",
    unidade: "pontos",
    meta: "< 1.500 (baixa concentração)",
    tipo: "max",
    regra: "Atenção: 1.500 a 2.500 (moderada) · Fora: acima de 2.500 (alta)",
    serie: "HHI no fim de cada mês",
    rota: "/r07-concentracao",
    origem: "R07",
  },
  {
    id: "limiteGrupo",
    secao: "risco",
    nome: "Maior utilização de limite",
    curto: "Limite por grupo",
    resumo: "Participação do grupo ÷ limite por rating",
    formula: "Maior participação de um grupo econômico ÷ limite da política pelo rating (Soberano sem limite; AAA 25%; AA 15%; A 5%)",
    unidade: "% do limite",
    meta: "≤ 100% do limite",
    tipo: "max",
    regra: "Atenção: a partir de 80% do limite · Fora: acima de 100%",
    serie: "Maior utilização no fim de cada mês (%)",
    rota: "/r07-concentracao",
    origem: "R07",
  },
  {
    id: "cambial",
    secao: "risco",
    nome: "Exposição cambial",
    curto: "Cambial",
    resumo: "Time deposits e fundo cambial ÷ saldo",
    formula: "Time deposits em USD/EUR (convertidos pela PTAX) e fundo cambial ÷ saldo bruto (regra da política)",
    unidade: "%",
    meta: "≤ 10% da carteira (política de investimentos)",
    tipo: "max",
    regra: "Atenção: a partir de 8% · Fora: acima de 10%",
    serie: "% da carteira no fim de cada mês",
    rota: "/r11-moeda-tipo",
    origem: "R11",
  },
  {
    id: "credito",
    secao: "risco",
    nome: "Crédito privado",
    curto: "Crédito privado",
    resumo: "Debêntures, CRI, CRA e fundos de crédito",
    formula: "Debêntures, CRI, CRA e fundos de crédito privado ÷ saldo bruto (regra da política)",
    unidade: "%",
    meta: "≤ 20% da carteira (política de investimentos)",
    tipo: "max",
    regra: "Atenção: a partir de 16% · Fora: acima de 20%",
    serie: "% da carteira no fim de cada mês",
    rota: "/r07-concentracao",
    origem: "R07",
  },
  {
    id: "carga",
    secao: "custos",
    nome: "Carga tributária efetiva 12m",
    curto: "Carga tributária",
    resumo: "(IR + IOF) ÷ rendimento bruto",
    formula: "(IR + IOF) ÷ rendimento bruto dos últimos 12 meses (IR regressivo, IRPJ/CSLL nos time deposits, isenções de LCI/LCA)",
    unidade: "%",
    meta: "≤ 20% do rendimento bruto",
    tipo: "max",
    regra: "Atenção: a partir de 18% · Fora: acima de 20%",
    serie: "Carga acumulada na janela até cada fim de mês (%)",
    rota: "/r03-rentabilidade",
    origem: "R03",
  },
  {
    id: "taxas",
    secao: "custos",
    nome: "Taxas e tarifas 12 meses",
    curto: "Taxas",
    resumo: "Fundos (adm./perf.), custódia e tarifas de TD",
    formula: "Taxas de administração e performance dos fundos + custódia B3 e taxa do agente dos títulos + tarifas de time deposits (12 meses) ÷ saldo médio",
    unidade: "R$ · bps a.a.",
    meta: "≤ 25 bps a.a. sobre o saldo médio",
    tipo: "max",
    regra: "Atenção: a partir de 20 bps · Fora: acima de 25 bps",
    serie: "Custo do mês em bps a.a. sobre o saldo médio",
    rota: "/r09-fundos",
    origem: "R09",
  },
  {
    id: "comeCotas",
    secao: "custos",
    nome: "Come-cotas antecipado no ano",
    curto: "Come-cotas",
    resumo: "IR recolhido por redução de cotas desde 1º/jan",
    formula: "IR antecipado no come-cotas (último dia útil de maio e de novembro) desde 1º de janeiro, sem saída de caixa",
    unidade: "R$",
    meta: "Fundos sujeitos a come-cotas ≤ 20% da carteira (política de investimentos)",
    tipo: "max",
    regra: "Atenção: fundos a partir de 16% da carteira · Fora: acima de 20%",
    serie: "Come-cotas de cada mês (R$ mil)",
    rota: "/r09-fundos",
    origem: "R09",
  },
  {
    id: "carry",
    secao: "divida",
    nome: "Carry: aplicações × dívida",
    curto: "Carry",
    resumo: "Taxa média das aplicações − custo da dívida",
    formula: "Taxa bruta média das aplicações (cenário das Premissas, ponderada pelo saldo) − custo médio ponderado da dívida (custo amortizado)",
    unidade: "p.p.",
    meta: "≥ −1,50 p.p. (custo de carregamento tolerado)",
    tipo: "min",
    regra: "Atenção: entre −1,50 e −0,75 p.p. · Fora: abaixo de −1,50 p.p.",
    serie: "Carry no fim de cada mês (p.p.)",
    rota: "/r06-indicadores",
    origem: "R06",
    consolidado: true,
  },
  {
    id: "dlEbitda",
    secao: "divida",
    nome: "Dívida líquida / EBITDA",
    curto: "DL/EBITDA",
    resumo: "(Dívida − caixa − aplicações) ÷ EBITDA 12m",
    formula: "(Dívida bruta − caixa − aplicações pelo valor contábil) ÷ EBITDA dos últimos 12 meses – covenant das debêntures e da CCB",
    unidade: "x",
    meta: "≤ 3,00x (covenant contratual)",
    tipo: "max",
    regra: "Atenção: a partir de 2,50x · Fora: acima de 3,00x",
    serie: "Apurações trimestrais do covenant",
    rota: "/r06-indicadores",
    origem: "R06",
    consolidado: true,
  },
  {
    id: "cobertura",
    secao: "divida",
    nome: "Aplicações ÷ dívida de curto prazo",
    curto: "Cobertura CP",
    resumo: "Valor contábil ÷ dívida circulante",
    formula: "Aplicações pelo valor contábil (CPC 48) ÷ dívida circulante pelo custo amortizado (inclui reclassificação CPC 26.74, se houver)",
    unidade: "x",
    meta: "≥ 1,00x",
    tipo: "min",
    regra: "Atenção: até 1,20x · Fora: abaixo de 1,00x",
    serie: "Cobertura no fim de cada mês (x)",
    rota: "/r06-indicadores",
    origem: "R06",
    consolidado: true,
  },
];

const DEF = Object.fromEntries(DEFINICOES.map((d) => [d.id, d])) as Record<KpiId, DefinicaoKpi>;

const REGRA_CURTA: Record<string, string> = {
  credito: "Crédito privado",
  fundos: "Fundos",
  liquidez: "Liquidez imediata",
  longo: "Prazo > 2 anos",
  pre: "Prefixado",
  exterior: "Exposição cambial",
  rv: "Renda variável",
};

// ---------------------------------------------------------------------------
// Status, tendência e formatação
// ---------------------------------------------------------------------------

const ESTADO_SEMAFORO: Record<Semaforo, ValueState> = { ok: "positive", atencao: "critical", excedido: "negative" };

const STATUS_TEXTO: Record<ValueState, string> = {
  positive: "Na meta",
  critical: "Atenção",
  negative: "Fora da meta",
  neutral: "Sem dados",
  information: "Informativo",
};

const ORDEM_ESTADO: Record<ValueState, number> = { negative: 0, critical: 1, positive: 2, information: 3, neutral: 4 };

function estadoLimite(v: number, tipo: "max" | "min", limite: number, alerta: number): ValueState {
  if (tipo === "max") return v > limite ? "negative" : v >= alerta ? "critical" : "positive";
  return v < limite ? "negative" : v <= alerta ? "critical" : "positive";
}

/** Desvio em p.p. do CDI contra o benchmark: tolerância de ±0,5 p.p. (mesma do cadastro BMK) */
function estadoBenchmark(desvio: number): ValueState {
  if (desvio >= -TOLERANCIA_BENCHMARK) return "positive";
  return desvio >= -P.bmkFora ? "critical" : "negative";
}

/** Formato do delta: "brl" (R$ compacto) ou escala/casas/sufixo */
type FmtDelta = "brl" | { escala: number; casas: number; sufixo: string };

function comSinal(d: number, f: FmtDelta): { texto: string; zero: boolean } {
  if (f === "brl") {
    const zero = Math.abs(d) < 50;
    return { texto: `${zero ? "" : d > 0 ? "+" : "−"}${fmtCompact(Math.abs(d))}`, zero };
  }
  const a = Math.abs(d * f.escala);
  const zero = Number(a.toFixed(f.casas)) === 0;
  return { texto: `${zero ? "" : d > 0 ? "+" : "−"}${fmtDec(a, f.casas)}${f.sufixo}`, zero };
}

function tendencia(d: number | null, f: FmtDelta, melhor: "up" | "down" | null, sufixo = "no mês"): KpiTendencia | undefined {
  if (d === null || !Number.isFinite(d)) return undefined;
  const { texto, zero } = comSinal(d, f);
  if (zero) return { texto: `estável ${sufixo}`, direcao: "flat", favoravel: null };
  const direcao = d > 0 ? "up" : "down";
  return { texto: `${texto} ${sufixo}`, direcao, favoravel: melhor === null ? null : (direcao === "up") === (melhor === "up") };
}

const PP: FmtDelta = { escala: 100, casas: 1, sufixo: " p.p." };
const PP2: FmtDelta = { escala: 100, casas: 2, sufixo: " p.p." };
const X2: FmtDelta = { escala: 1, casas: 2, sufixo: "x" };
const ANO: FmtDelta = { escala: 1, casas: 2, sufixo: " ano" };

/** R$ no cartão: número + escala na unidade ("88,5" "R$ mi") */
function dinheiro(v: number): { valor: string; unidade: string } {
  const a = Math.abs(v);
  if (a >= 1e6) return { valor: fmtDec(v / 1e6, 1), unidade: "R$ mi" };
  if (a >= 1e3) return { valor: fmtDec(v / 1e3, 1), unidade: "R$ mil" };
  return { valor: fmtDec(v / 1e3, 1), unidade: "R$ mil" };
}

const pct1 = (v: number) => `${fmtDec(v * 100, 1)}%`;

// ---------------------------------------------------------------------------
// Cálculo do painel
// ---------------------------------------------------------------------------

interface KpiCalc {
  def: DefinicaoKpi;
  /** valor numérico na unidade-base (R$, fração, dias, anos, pontos, x) – exportação */
  valor: number | null;
  valorTexto: string;
  unidade: string;
  metaTexto: string;
  desvioRotulo: "Desvio" | "Folga";
  desvioTexto: string;
  state: ValueState;
  statusTexto: string;
  tendencia?: KpiTendencia;
  serie: { x: string; y: number }[];
  /** unidade do micrográfico (exportação) */
  serieUnidade: string;
  referencia?: number;
  laterais: KpiIndicadorLateral[];
  detalhe?: string;
}

interface Foto {
  data: string;
  cs: ContratoMestre[];
  saldo: number;
  contabil: number;
  politica: ResultadoRegra[];
  grupos: GrupoExposicao[];
  hhi: number;
  enquadradas: number;
  totalRegras: number;
  emAtencao: string[];
  excedidas: string[];
  maiorUtil: GrupoExposicao | null;
  prazoMedio: number | null;
  venc90: number;
  venc90n: number;
  duration: number | null;
  titulos: number;
  mercadoTitulos: number;
}

/** Fotografia de um fim de mês na Carteira-Mestre (premissas da data-base) */
function fotografar(data: string, p: Premissas, escopo: Escopo): Foto {
  const cs = contratosMestre(data, p, escopo);
  const soma = (xs: ContratoMestre[], fn: (c: ContratoMestre) => number) => xs.reduce((s, c) => s + fn(c), 0);
  const saldo = soma(cs, (c) => c.saldoCurva);
  const politica = avaliarPolitica(cs);
  const grupos = concentracaoPorGrupo(cs);
  const comVenc = cs.filter((c) => c.prazoRemanescente !== null);
  const saldoVenc = soma(comVenc, (c) => c.saldoCurva);
  const venc = cs.filter((c) => c.prazoRemanescente !== null && c.prazoRemanescente >= 0 && c.prazoRemanescente <= 90);
  const tits = TITULOS.filter((t) => escopo === "todas" || t.empresa === escopo)
    .map((t) => posicaoTitulo(t, data, p))
    .filter((x) => x.ativo);
  const mercado = tits.reduce((s, x) => s + x.saldoMercado, 0);
  const comLimite = grupos.filter((g) => g.limite < 1);
  return {
    data,
    cs,
    saldo,
    contabil: soma(cs, (c) => c.valorContabil),
    politica,
    grupos,
    hhi: hhi(grupos.map((g) => g.share)),
    enquadradas: politica.filter((r) => r.status !== "excedido").length + grupos.filter((g) => g.status !== "excedido").length,
    totalRegras: politica.length + grupos.length,
    emAtencao: [
      ...politica.filter((r) => r.status === "atencao").map((r) => REGRA_CURTA[r.id] ?? r.regra),
      ...grupos.filter((g) => g.status === "atencao").map((g) => g.grupo),
    ],
    excedidas: [
      ...politica.filter((r) => r.status === "excedido").map((r) => REGRA_CURTA[r.id] ?? r.regra),
      ...grupos.filter((g) => g.status === "excedido").map((g) => g.grupo),
    ],
    maiorUtil: comLimite.length ? [...comLimite].sort((a, b) => b.utilizacao - a.utilizacao)[0] : null,
    prazoMedio: saldoVenc > 0 ? soma(comVenc, (c) => c.prazoRemanescente! * c.saldoCurva) / saldoVenc : null,
    venc90: soma(venc, (c) => c.saldoCurva),
    venc90n: venc.length,
    duration: mercado > 0 ? tits.reduce((s, x) => s + x.duration * x.saldoMercado, 0) / mercado : null,
    titulos: tits.length,
    mercadoTitulos: mercado,
  };
}

/** Aplicações × dívida no fim do mês – sempre consolidado */
function fotoDivida(data: string, p: Premissas) {
  const aplic = contratosMestre(data, p);
  const contabil = aplic.reduce((s, c) => s + c.valorContabil, 0);
  const circulante = posicoesDivida(CONTRATOS, data, p, reclassificadosEm(data)).reduce((s, x) => s + x.circulante, 0);
  const custo = custoMedioPonderado(posicoesDivida(CONTRATOS, data, p));
  const taxa = calcularCarry(aplic, p).taxaBruta;
  return { data, contabil, circulante, cobertura: circulante > 0 ? contabil / circulante : null, taxa, custo, carry: taxa - custo };
}

interface ResumoRent {
  ini: string;
  fim: string;
  rend: number;
  liq: number;
  ir: number;
  iof: number;
  taxas: number;
  /** taxas explícitas por tipo: custódia dos títulos e tarifas dos time deposits */
  custodia: number;
  tarifas: number;
  capital: number;
  cmp: ComparacaoBenchmark | null;
  pctBruto: number;
  pctLiq: number;
  bmk: number;
  metaLiq: number;
  rentabLiq: number;
  realAA: number;
  carga: number;
}

/** Consolida as linhas de rentabilidade da Carteira-Mestre no período (mesmo método do R03) */
function resumir(ls: RentabContrato[], ini: string, fim: string, p: Premissas, cadastro: Benchmark[] | null): ResumoRent {
  const soma = (fn: (l: RentabContrato) => number) => ls.reduce((s, l) => s + fn(l), 0);
  const dias = Math.max(1, diffDays(ini, fim));
  const rend = soma((l) => l.rendimento);
  const liq = soma((l) => l.rendLiquido);
  const capital = soma((l) => l.base * (l.dias / dias));
  const cmp = cadastro ? compararCarteira(ls, cadastro, p) : null;
  const peso = cmp ? cmp.peso : soma((l) => l.base * l.cdiPeriodo);
  const rentabLiq = capital > 0 ? liq / capital : 0;
  const bmk = cmp?.pct ?? 1;
  return {
    ini,
    fim,
    rend,
    liq,
    ir: soma((l) => l.ir),
    iof: soma((l) => l.iof),
    taxas: soma((l) => l.taxas),
    custodia: ls.filter((l) => l.tipo === "Tesouro Direto").reduce((s, l) => s + l.taxas, 0),
    tarifas: ls.filter((l) => l.tipo === "Time deposit").reduce((s, l) => s + l.taxas, 0),
    capital,
    cmp,
    pctBruto: cmp ? cmp.realizado : peso > 0 ? rend / peso : 0,
    pctLiq: peso > 0 ? liq / peso : 0,
    bmk,
    metaLiq: bmk * (1 - P.cargaMax),
    rentabLiq,
    // anualizada pelo prazo da janela e deflacionada pelo IPCA 12 meses da premissa (12 meses: igual ao R03)
    realAA: Math.pow(1 + rentabLiq, 365 / dias) / (1 + p.ipca12m) - 1,
    carga: rend > 0 ? (soma((l) => l.ir) + soma((l) => l.iof)) / rend : 0,
  };
}

function montarPainel(p: Premissas, escopo: Escopo, cadastro: Benchmark[]) {
  const db = p.dataBase;
  const fins = lastMonthEnds(db, 14);
  const iniAnt = fins[0];
  const ini12 = fins[1];
  const meses = fins.slice(2);
  const mesAnt = meses[meses.length - 2];
  const x = meses.map(fmtMonthShort);
  const noEscopo = (empresa: string) => escopo === "todas" || empresa === escopo;
  const serie = (ys: number[]) => ys.map((y, i) => ({ x: x[i], y }));
  const ultimo = <T,>(xs: T[]) => xs[xs.length - 1];
  const penultimo = <T,>(xs: T[]) => xs[xs.length - 2];

  // Fotografias de fim de mês (Carteira-Mestre) e aplicações × dívida (consolidado)
  const fotos = meses.map((m) => fotografar(m, p, escopo));
  const f = ultimo(fotos);
  const fAnt = penultimo(fotos);
  const dividas = meses.map((m) => fotoDivida(m, p));
  const endiv = endividamentoEm(p);
  const carry = calcularCarry(contratosMestre(db, p), p);
  const dAnt = penultimo(dividas);

  // Fluxos: evolução mensal (R05), rentabilidade 12 meses (R03/BMK) e a janela até o mês anterior (tendência)
  const evol = evolucaoMestre(meses, p, escopo);
  const evolAnt = evolucaoMestre(fins.slice(1, 13), p, escopo);
  const r12 = resumir(rentabilidadeMestre(ini12, db, p, escopo), ini12, db, p, cadastro);
  const rAnt = resumir(rentabilidadeMestre(iniAnt, mesAnt, p, escopo), iniAnt, mesAnt, p, cadastro);
  const mensal = meses.map((m, i) => {
    const ini = i === 0 ? ini12 : meses[i - 1];
    return resumir(rentabilidadeMestre(ini, m, p, escopo), ini, m, p, cadastro);
  });
  const acumulado = meses.map((m) => resumir(rentabilidadeMestre(ini12, m, p, escopo), ini12, m, p, null));

  // Taxas dos fundos (adm./perf.) cobradas na cota no período
  const fundos = FUNDOS.filter((x) => noEscopo(x.empresa));
  const taxasFundoAte = (fu: Fundo, d: string) => {
    if (d < fu.dataAplicacao) return 0;
    const ate = fu.dataResgate && d >= fu.dataResgate ? addDays(fu.dataResgate, -1) : d;
    return posicaoFundo(fu, ate, p).taxas;
  };
  const taxasFundos = (ini: string, fim: string) => fundos.reduce((s, fu) => s + taxasFundoAte(fu, fim) - taxasFundoAte(fu, ini), 0);
  const saldoMedio = (ms: { saldoInicial: number; saldoFinal: number }[]) =>
    ms.length ? ms.reduce((s, m) => s + (m.saldoInicial + m.saldoFinal) / 2, 0) / ms.length : 0;
  const bps = (taxas: number, saldo: number, ini: string, fim: string) =>
    saldo > 0 ? (taxas / saldo) * 1e4 * (365 / Math.max(1, diffDays(ini, fim))) : 0;
  const fundos12 = taxasFundos(ini12, db);
  const taxas12 = r12.taxas + fundos12;
  const bps12 = bps(taxas12, saldoMedio(evol), ini12, db);
  const taxasAnt = rAnt.taxas + taxasFundos(iniAnt, mesAnt);
  const bpsAnt = bps(taxasAnt, saldoMedio(evolAnt), iniAnt, mesAnt);
  const bpsMes = meses.map((m, i) => {
    const ini = i === 0 ? ini12 : meses[i - 1];
    return bps(mensal[i].taxas + taxasFundos(ini, m), saldoMedio([evol[i]]), ini, m);
  });

  // Come-cotas: no ano, 12 meses e próximo evento (projeção com o último dado disponível)
  const ccAno = movimentacaoMestre(previousYearEnd(db), db, p, escopo).total.comeCotas;
  const ccAnoAnt = movimentacaoMestre(previousYearEnd(mesAnt), mesAnt, p, escopo).total.comeCotas;
  const cc12 = evol.reduce((s, m) => s + m.comeCotas, 0);
  const proximos = fundos
    .map((fu) => ({ fu, pos: posicaoFundo(fu, db, p) }))
    .filter((x) => x.pos.ativo && x.pos.proximoComeCotas)
    .map((x) => ({ data: x.pos.proximoComeCotas!, ir: historicoFundo(x.fu, p).comeCotas.find((e) => e.data === x.pos.proximoComeCotas)?.ir ?? 0 }));
  const dataProx = proximos.length ? proximos.map((x) => x.data).sort()[0] : null;
  const irProx = proximos.filter((x) => x.data === dataProx).reduce((s, x) => s + x.ir, 0);

  // Covenant DL/EBITDA (mesma apuração do R06 e da carteira de captações)
  const covDl = apurarCovenants(db).find((a) => a.cov.id === "dlEbitda")!;
  const hist = covDl.historico.filter((h) => Number.isFinite(h.valor));

  const regra = (fo: Foto, id: string) => fo.politica.find((r) => r.id === id)!;
  const moedaEstrangeira = f.cs.filter((c) => c.moeda !== "BRL").reduce((s, c) => s + c.saldoCurva, 0);
  const kpis: KpiCalc[] = [];
  const add = (id: KpiId, k: Omit<KpiCalc, "def">) => kpis.push({ def: DEF[id], ...k });

  // --- Política: enquadramento (R07) ---
  {
    const exc = f.excedidas.length;
    const at = f.emAtencao.length;
    const state: ValueState = exc ? "negative" : at ? "critical" : "positive";
    add("enquadramento", {
      valor: f.enquadradas,
      valorTexto: `${f.enquadradas}/${f.totalRegras}`,
      unidade: "enquadradas",
      metaTexto: `${f.totalRegras}/${f.totalRegras}`,
      desvioRotulo: "Desvio",
      desvioTexto: exc ? `${exc} excedida${exc > 1 ? "s" : ""}` : "nenhuma excedida",
      state,
      statusTexto: exc ? `${exc} desenquadrada${exc > 1 ? "s" : ""}` : at ? `${at} em atenção` : "Enquadrado",
      tendencia: tendencia(exc - fAnt.excedidas.length, { escala: 1, casas: 0, sufixo: exc - fAnt.excedidas.length === 1 || exc - fAnt.excedidas.length === -1 ? " excedida" : " excedidas" }, "down"),
      serie: serie(fotos.map((fo) => (fo.enquadradas / fo.totalRegras) * 100)),
      serieUnidade: "% enquadrado",
      referencia: 100,
      laterais: [
        { label: "Em atenção", value: String(at), state: at ? "critical" : "positive" },
        { label: "Excedidas", value: String(exc), state: exc ? "negative" : "positive" },
      ],
      detalhe: exc
        ? `Excedidas: ${f.excedidas.join(", ")}${at ? ` · atenção: ${f.emAtencao.join(", ")}` : ""}`
        : at
          ? `Em atenção: ${f.emAtencao.join(", ")}`
          : "Todas as regras da política e limites por grupo com folga.",
    });
  }

  // --- 1. Tamanho e resultado ---
  {
    const meta = P.reservaMinima[escopo] ?? P.reservaMinima.todas;
    const state = estadoLimite(f.saldo, "min", meta, meta * 1.2);
    const dm = dinheiro(f.saldo);
    add("saldo", {
      valor: f.saldo,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      metaTexto: `≥ ${fmtCompact(meta)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(f.saldo - meta, "brl").texto,
      state,
      statusTexto: state === "negative" ? "Abaixo da reserva" : STATUS_TEXTO[state],
      tendencia: tendencia(fAnt.saldo > 0 ? f.saldo / fAnt.saldo - 1 : null, { escala: 100, casas: 1, sufixo: "%" }, "up"),
      serie: serie(fotos.map((fo) => fo.saldo / 1e6)),
      serieUnidade: "R$ mi",
      referencia: meta / 1e6,
      laterais: [
        { label: "Reserva mínima", value: fmtCompact(meta) },
        { label: "Folga", value: comSinal(f.saldo - meta, "brl").texto, state },
      ],
      detalhe: `${f.cs.length} contratos · valor contábil (CPC 48) ${fmtCompact(f.contabil)}`,
    });
  }
  {
    const cmp = r12.cmp!;
    const d = r12.pctBruto - r12.bmk;
    const state = estadoBenchmark(d);
    const dm = dinheiro(r12.rend);
    add("rendBruto", {
      valor: r12.rend,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      metaTexto: `≥ ${fmtCompact(cmp.rendBenchmark)} (benchmark)`,
      desvioRotulo: "Desvio",
      desvioTexto: comSinal(cmp.rendBenchmark > 0 ? r12.rend / cmp.rendBenchmark - 1 : 0, { escala: 100, casas: 1, sufixo: "%" }).texto,
      state,
      statusTexto: SITUACAO_TEXTO[situacaoBenchmark(r12.pctBruto, r12.bmk)],
      tendencia: tendencia(r12.rend - rAnt.rend, "brl", "up"),
      serie: serie(evol.map((m) => m.rendimentos / 1e6)),
      serieUnidade: "R$ mi",
      laterais: [
        { label: "Benchmark", value: fmtCompact(cmp.rendBenchmark) },
        {
          label: "Desvio",
          value: comSinal(cmp.rendBenchmark > 0 ? r12.rend / cmp.rendBenchmark - 1 : 0, { escala: 100, casas: 1, sufixo: "%" }).texto,
          state,
        },
      ],
      detalhe: `${fmtDec(r12.pctBruto * 100, 1)}% do CDI × benchmark de ${fmtDec(r12.bmk * 100, 1)}% (12 meses)`,
    });
  }
  {
    const meta = (r12.cmp?.rendBenchmark ?? 0) * (1 - P.cargaMax);
    const state = estadoBenchmark(r12.pctLiq - r12.metaLiq);
    const dm = dinheiro(r12.liq);
    const desvio = comSinal(meta > 0 ? r12.liq / meta - 1 : 0, { escala: 100, casas: 1, sufixo: "%" }).texto;
    add("rendLiquido", {
      valor: r12.liq,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      metaTexto: `≥ ${fmtCompact(meta)}`,
      desvioRotulo: "Desvio",
      desvioTexto: desvio,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tendencia(r12.liq - rAnt.liq, "brl", "up"),
      serie: serie(mensal.map((m) => m.liq / 1e6)),
      serieUnidade: "R$ mi",
      laterais: [
        { label: "Meta", value: fmtCompact(meta) },
        { label: "Desvio", value: desvio, state },
      ],
      detalhe: `IR ${fmtCompact(r12.ir)} · IOF ${fmtCompact(r12.iof)} · custódia e tarifas ${fmtCompact(r12.taxas)}`,
    });
  }

  // --- 2. Rentabilidade ---
  {
    const d = r12.pctBruto - r12.bmk;
    const state = estadoBenchmark(d);
    add("pctBruto", {
      valor: r12.pctBruto,
      valorTexto: fmtDec(r12.pctBruto * 100, 1),
      unidade: "% do CDI",
      metaTexto: `≥ ${pct1(r12.bmk)} (benchmark)`,
      desvioRotulo: "Desvio",
      desvioTexto: comSinal(d, PP).texto,
      state,
      statusTexto: SITUACAO_TEXTO[situacaoBenchmark(r12.pctBruto, r12.bmk)],
      tendencia: tendencia(r12.pctBruto - rAnt.pctBruto, PP, "up"),
      serie: serie(evol.map((m) => m.pctCDI * 100)),
      serieUnidade: "% do CDI",
      referencia: r12.bmk * 100,
      laterais: [
        { label: "Benchmark", value: pct1(r12.bmk) },
        { label: "Desvio", value: comSinal(d, PP).texto, state },
      ],
      detalhe: `Micrográfico: % do CDI de cada mês sobre o saldo médio (R05); ${fmtMonthShort(db)}: ${pct1(ultimo(evol).pctCDI)}`,
    });
  }
  {
    const d = r12.pctLiq - r12.metaLiq;
    const state = estadoBenchmark(d);
    add("pctLiquido", {
      valor: r12.pctLiq,
      valorTexto: fmtDec(r12.pctLiq * 100, 1),
      unidade: "% do CDI",
      metaTexto: `≥ ${pct1(r12.metaLiq)}`,
      desvioRotulo: "Desvio",
      desvioTexto: comSinal(d, PP).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tendencia(r12.pctLiq - rAnt.pctLiq, PP, "up"),
      serie: serie(mensal.map((m) => m.pctLiq * 100)),
      serieUnidade: "% do CDI",
      referencia: r12.metaLiq * 100,
      laterais: [
        { label: "Meta", value: pct1(r12.metaLiq) },
        { label: "Desvio", value: comSinal(d, PP).texto, state },
      ],
      detalhe: `Meta = benchmark ${pct1(r12.bmk)} × (1 − ${fmtPct(P.cargaMax, 0)} de carga tributária-meta)`,
    });
  }
  {
    const state = estadoLimite(r12.realAA, "min", P.realMin, P.realAlerta);
    add("real", {
      valor: r12.realAA,
      valorTexto: fmtDec(r12.realAA * 100, 1),
      unidade: "% a.a.",
      metaTexto: `≥ ${fmtPct(P.realMin, 1)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(r12.realAA - P.realMin, PP).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tendencia(r12.realAA - rAnt.realAA, PP, "up"),
      serie: serie(mensal.map((m) => m.realAA * 100)),
      serieUnidade: "% a.a.",
      referencia: P.realMin * 100,
      laterais: [
        { label: "Meta", value: `≥ ${fmtPct(P.realMin, 1)}` },
        { label: "IPCA 12m", value: fmtPct(p.ipca12m, 2) },
      ],
      detalhe: `Rentabilidade líquida ${fmtPct(r12.rentabLiq, 1)} sobre o capital médio; IPCA 12m da premissa (SAP)`,
    });
  }
  {
    const cmp = r12.cmp!;
    const state = estadoBenchmark(r12.pctBruto - r12.bmk);
    const dm = dinheiro(cmp.excesso);
    add("excesso", {
      valor: cmp.excesso,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      metaTexto: "≥ R$ 0",
      desvioRotulo: "Desvio",
      desvioTexto: comSinal(r12.pctBruto - r12.bmk, PP).texto,
      state,
      statusTexto: SITUACAO_TEXTO[situacaoBenchmark(r12.pctBruto, r12.bmk)],
      tendencia: tendencia(cmp.excesso - (rAnt.cmp?.excesso ?? 0), "brl", "up"),
      serie: serie(evol.map((m, i) => (m.rendimentos - (mensal[i].cmp?.rendBenchmark ?? 0)) / 1e3)),
      serieUnidade: "R$ mil",
      referencia: 0,
      laterais: [
        { label: "Meta", value: "≥ R$ 0" },
        { label: "Em p.p. do CDI", value: comSinal(r12.pctBruto - r12.bmk, PP).texto, state },
      ],
      detalhe: `Realizado ${fmtCompact(cmp.rendimento)} × benchmark ${fmtCompact(cmp.rendBenchmark)}`,
    });
  }

  // --- 3. Liquidez e prazo ---
  {
    const r = regra(f, "liquidez");
    const state = ESTADO_SEMAFORO[r.status];
    add("liquidez", {
      valor: r.share,
      valorTexto: fmtDec(r.share * 100, 1),
      unidade: "%",
      metaTexto: `≥ ${fmtPct(r.limite, 0)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(r.share - r.limite, PP).texto,
      state,
      statusTexto: SEMAFORO_TEXTO[r.status],
      tendencia: tendencia(r.share - regra(fAnt, "liquidez").share, PP, "up"),
      serie: serie(fotos.map((fo) => regra(fo, "liquidez").share * 100)),
      serieUnidade: "% da carteira",
      referencia: r.limite * 100,
      laterais: [
        { label: "Mínimo", value: fmtPct(r.limite, 0) },
        { label: "Folga", value: comSinal(r.share - r.limite, PP).texto, state },
      ],
      detalhe: `${fmtCompact(r.valor)} resgatáveis em até D+1 ou vencendo em 30 dias`,
    });
  }
  {
    const v = f.prazoMedio;
    const state: ValueState = v === null ? "neutral" : estadoLimite(v, "max", P.prazoMax, P.prazoAlerta);
    add("prazo", {
      valor: v,
      valorTexto: v === null ? "—" : fmtInt(Math.round(v)),
      unidade: "dias",
      metaTexto: `≤ ${fmtInt(P.prazoMax)} dias`,
      desvioRotulo: "Folga",
      desvioTexto: v === null ? "—" : comSinal(Math.round(P.prazoMax - v), { escala: 1, casas: 0, sufixo: " dias" }).texto,
      state,
      statusTexto: v === null ? "Sem contratos com vencimento" : STATUS_TEXTO[state],
      tendencia:
        v !== null && fAnt.prazoMedio !== null ? tendencia(Math.round(v) - Math.round(fAnt.prazoMedio), { escala: 1, casas: 0, sufixo: " dias" }, "down") : undefined,
      serie: serie(fotos.map((fo) => fo.prazoMedio ?? 0)),
      serieUnidade: "dias",
      referencia: P.prazoMax,
      laterais: [
        { label: "Limite", value: `${fmtInt(P.prazoMax)} dias` },
        { label: "Em anos", value: v === null ? "—" : fmtDec(v / 365, 1), state },
      ],
      detalhe: "Fundos abertos (sem vencimento) ficam fora do cálculo",
    });
  }
  {
    const share = f.saldo > 0 ? f.venc90 / f.saldo : 0;
    const state = estadoLimite(share, "max", P.venc90Max, P.venc90Alerta);
    const dm = dinheiro(f.venc90);
    add("venc90", {
      valor: f.venc90,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      metaTexto: `≤ ${fmtPct(P.venc90Max, 0)} da carteira`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(P.venc90Max - share, PP).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tendencia(f.venc90 - fAnt.venc90, "brl", null),
      serie: serie(fotos.map((fo) => fo.venc90 / 1e6)),
      serieUnidade: "R$ mi",
      laterais: [
        { label: "% da carteira", value: pct1(share), state },
        { label: "Contratos", value: String(f.venc90n) },
      ],
      detalhe: `Vencimentos até ${fmtDate(addDays(db, 90))} · limite de ${fmtPct(P.venc90Max, 0)} da carteira`,
    });
  }
  {
    const v = f.duration;
    const state: ValueState = v === null ? "neutral" : estadoLimite(v, "max", P.durationMax, P.durationAlerta);
    add("duration", {
      valor: v,
      valorTexto: v === null ? "—" : fmtDec(v, 2),
      unidade: "anos",
      metaTexto: `≤ ${fmtDec(P.durationMax, 1)} anos`,
      desvioRotulo: "Folga",
      desvioTexto: v === null ? "—" : comSinal(P.durationMax - v, ANO).texto,
      state,
      statusTexto: v === null ? "Sem títulos no escopo" : STATUS_TEXTO[state],
      tendencia:
        v !== null && fAnt.duration !== null ? tendencia(v - fAnt.duration, ANO, "down") : undefined,
      serie: serie(fotos.map((fo) => fo.duration ?? 0)),
      serieUnidade: "anos",
      referencia: v === null ? undefined : P.durationMax,
      laterais: [
        { label: "Limite", value: `${fmtDec(P.durationMax, 1)} anos` },
        { label: "Folga", value: v === null ? "—" : comSinal(P.durationMax - v, ANO).texto, state },
      ],
      detalhe: v === null ? "Nenhum título público no escopo" : `${f.titulos} títulos · ${fmtCompact(f.mercadoTitulos)} a mercado (ANBIMA)`,
    });
  }

  // --- 4. Risco e concentração ---
  {
    const classe = classificarHHI(f.hhi);
    const state = ESTADO_SEMAFORO[classe.status];
    add("hhi", {
      valor: f.hhi,
      valorTexto: fmtInt(Math.round(f.hhi)),
      unidade: "pontos",
      metaTexto: `< ${fmtInt(P.hhiLimite)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(Math.round(P.hhiLimite - f.hhi), { escala: 1, casas: 0, sufixo: " pontos" }).texto,
      state,
      statusTexto: classe.rotulo,
      tendencia: tendencia(Math.round(f.hhi) - Math.round(fAnt.hhi), { escala: 1, casas: 0, sufixo: " pontos" }, "down"),
      serie: serie(fotos.map((fo) => fo.hhi)),
      serieUnidade: "pontos",
      referencia: P.hhiLimite,
      laterais: [
        { label: "Limite", value: fmtInt(P.hhiLimite) },
        { label: "Grupos", value: String(f.grupos.length) },
      ],
      detalhe: f.grupos[0] ? `Maior grupo: ${f.grupos[0].grupo} (${fmtPct(f.grupos[0].share, 1)} da carteira)` : undefined,
    });
  }
  {
    const g = f.maiorUtil;
    const state: ValueState = g ? ESTADO_SEMAFORO[g.status] : "neutral";
    add("limiteGrupo", {
      valor: g?.utilizacao ?? null,
      valorTexto: g ? fmtDec(g.utilizacao * 100, 0) : "—",
      unidade: "% do limite",
      metaTexto: "≤ 100% do limite",
      desvioRotulo: "Folga",
      desvioTexto: g ? comSinal(P.utilMax - g.utilizacao, PP).texto : "—",
      state,
      statusTexto: g ? SEMAFORO_TEXTO[g.status] : "Sem grupos com limite",
      tendencia: g && fAnt.maiorUtil ? tendencia(g.utilizacao - fAnt.maiorUtil.utilizacao, PP, "down") : undefined,
      serie: serie(fotos.map((fo) => (fo.maiorUtil?.utilizacao ?? 0) * 100)),
      serieUnidade: "% do limite",
      referencia: 100,
      laterais: g
        ? [
            { label: "Participação", value: pct1(g.share) },
            { label: `Limite ${g.rating}`, value: fmtPct(g.limite, 0) },
          ]
        : [],
      detalhe: g ? `${g.grupo} · ${g.operacoes} contrato${g.operacoes > 1 ? "s" : ""} · rating ${g.rating}` : undefined,
    });
  }
  for (const [id, rid] of [
    ["cambial", "exterior"],
    ["credito", "credito"],
  ] as [KpiId, string][]) {
    const r = regra(f, rid);
    const state = ESTADO_SEMAFORO[r.status];
    add(id, {
      valor: r.share,
      valorTexto: fmtDec(r.share * 100, 1),
      unidade: "%",
      metaTexto: `≤ ${fmtPct(r.limite, 0)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(r.limite - r.share, PP).texto,
      state,
      statusTexto: SEMAFORO_TEXTO[r.status],
      tendencia: tendencia(r.share - regra(fAnt, rid).share, PP, "down"),
      serie: serie(fotos.map((fo) => regra(fo, rid).share * 100)),
      serieUnidade: "% da carteira",
      referencia: r.limite * 100,
      laterais: [
        { label: "Limite", value: fmtPct(r.limite, 0) },
        { label: "Folga", value: comSinal(r.limite - r.share, PP).texto, state },
      ],
      detalhe:
        id === "cambial"
          ? `Time deposits ${fmtCompact(moedaEstrangeira)}${r.valor - moedaEstrangeira >= 500 ? ` + fundo cambial ${fmtCompact(r.valor - moedaEstrangeira)}` : ""} · PTAX USD ${fmtDec(p.ptaxUSD, 4)} · EUR ${fmtDec(p.ptaxEUR, 4)}`
          : `${fmtCompact(r.valor)} em debêntures, CRI, CRA e fundos de crédito`,
    });
  }

  // --- 5. Custos e tributos ---
  {
    const state = estadoLimite(r12.carga, "max", P.cargaMax, P.cargaAlerta);
    add("carga", {
      valor: r12.carga,
      valorTexto: fmtDec(r12.carga * 100, 2),
      unidade: "%",
      metaTexto: `≤ ${fmtPct(P.cargaMax, 0)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(P.cargaMax - r12.carga, PP2).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tendencia(r12.carga - rAnt.carga, PP2, "down"),
      serie: serie(acumulado.map((a) => a.carga * 100)),
      serieUnidade: "% (acumulado na janela)",
      referencia: P.cargaMax * 100,
      laterais: [
        { label: "Limite", value: fmtPct(P.cargaMax, 0) },
        { label: "Folga", value: comSinal(P.cargaMax - r12.carga, PP2).texto, state },
      ],
      detalhe: `IR ${fmtCompact(r12.ir)} + IOF ${fmtCompact(r12.iof)} sobre ${fmtCompact(r12.rend)}`,
    });
  }
  {
    const state = estadoLimite(bps12, "max", P.taxasMax, P.taxasAlerta);
    const dm = dinheiro(taxas12);
    add("taxas", {
      valor: taxas12,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      metaTexto: `≤ ${fmtInt(P.taxasMax)} bps a.a.`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(P.taxasMax - bps12, { escala: 1, casas: 1, sufixo: " bps" }).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tendencia(bps12 - bpsAnt, { escala: 1, casas: 1, sufixo: " bps" }, "down"),
      serie: serie(bpsMes),
      serieUnidade: "bps a.a.",
      referencia: P.taxasMax,
      laterais: [
        { label: "Custo a.a.", value: `${fmtDec(bps12, 1)} bps`, state },
        { label: "Limite", value: `${fmtInt(P.taxasMax)} bps` },
      ],
      detalhe: `Fundos ${fmtCompact(fundos12)} (na cota) · custódia ${fmtCompact(r12.custodia)} · tarifas TD ${fmtCompact(r12.tarifas)}`,
    });
  }
  {
    const r = regra(f, "fundos");
    const state = ESTADO_SEMAFORO[r.status];
    const dm = dinheiro(ccAno);
    add("comeCotas", {
      valor: ccAno,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      metaTexto: `Fundos ≤ ${fmtPct(r.limite, 0)} da carteira`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(r.limite - r.share, PP).texto,
      state,
      statusTexto: r.status === "ok" ? "Fundos dentro do limite" : r.status === "atencao" ? "Fundos perto do limite" : "Fundos acima do limite",
      tendencia: tendencia(ccAno - ccAnoAnt, "brl", null),
      serie: serie(evol.map((m) => m.comeCotas / 1e3)),
      serieUnidade: "R$ mil",
      laterais: [
        { label: "12 meses", value: fmtCompact(cc12) },
        { label: "Fundos", value: pct1(r.share), state },
      ],
      detalhe: dataProx
        ? `Próximo: ${fmtDate(dataProx)} · estimado ${fmtCompact(irProx)} (projeção com o último dado disponível)`
        : "Sem come-cotas previsto para os fundos do escopo",
    });
  }

  // --- 6. Aplicações × dívida (consolidado) ---
  {
    const v = carry.carryBruto;
    const state = estadoLimite(v, "min", P.carryMin, P.carryAlerta);
    add("carry", {
      valor: v,
      valorTexto: fmtDec(v * 100, 2),
      unidade: "p.p.",
      metaTexto: `≥ ${fmtDec(P.carryMin * 100, 2)} p.p.`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(v - P.carryMin, PP2).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tendencia(v - dAnt.carry, PP2, "up"),
      serie: serie(dividas.map((d, i) => (i === dividas.length - 1 ? v : d.carry) * 100)),
      serieUnidade: "p.p.",
      referencia: P.carryMin * 100,
      laterais: [
        { label: "Mínimo", value: `${fmtDec(P.carryMin * 100, 2)} p.p.` },
        { label: "R$ a.a.", value: fmtCompact(carry.custoCarregamento), state: carry.custoCarregamento < 0 ? "critical" : "positive" },
      ],
      detalhe: `Aplicações ${fmtPct(carry.taxaBruta)} a.a. × dívida ${fmtPct(carry.custoDivida)} a.a.`,
    });
  }
  {
    const rot = rotuloCovenant(covDl);
    const v = covDl.dataApuracao ? covDl.valor : null;
    const anterior = hist.length > 1 ? hist[hist.length - 2].valor : null;
    add("dlEbitda", {
      valor: v,
      valorTexto: v === null ? "—" : fmtDec(v, 2),
      unidade: "x",
      metaTexto: `≤ ${fmtDec(covDl.cov.limite, 2)}x`,
      desvioRotulo: "Folga",
      desvioTexto: v === null ? "—" : comSinal(covDl.folga, X2).texto,
      state: rot.state,
      statusTexto: rot.texto,
      tendencia: v !== null && anterior !== null ? tendencia(v - anterior, X2, "down", "no trimestre") : undefined,
      serie: hist.map((h) => ({ x: fmtQuarter(h.data), y: h.valor })),
      serieUnidade: "x (trimestral)",
      referencia: covDl.cov.limite,
      laterais: [
        { label: "Limite", value: `${fmtDec(covDl.cov.limite, 2)}x` },
        { label: "Alerta", value: `${fmtDec(covDl.cov.alerta, 2)}x` },
      ],
      detalhe: covDl.dataApuracao ? `Covenant – apuração ${fmtQuarter(covDl.dataApuracao)} (${fmtDate(covDl.dataApuracao)})` : "Sem apuração até a data-base",
    });
  }
  {
    const v = endiv.dividaCirculante > 0 ? endiv.aplicacoesContabil / endiv.dividaCirculante : null;
    const state: ValueState = v === null ? "neutral" : estadoLimite(v, "min", P.coberturaMin, P.coberturaAlerta);
    add("cobertura", {
      valor: v,
      valorTexto: v === null ? "—" : fmtDec(v, 2),
      unidade: "x",
      metaTexto: `≥ ${fmtDec(P.coberturaMin, 2)}x`,
      desvioRotulo: "Folga",
      desvioTexto: v === null ? "—" : comSinal(v - P.coberturaMin, X2).texto,
      state,
      statusTexto: v === null ? "Sem dívida circulante" : STATUS_TEXTO[state],
      tendencia: v !== null && dAnt.cobertura !== null ? tendencia(v - dAnt.cobertura, X2, "up") : undefined,
      serie: serie(dividas.map((d, i) => (i === dividas.length - 1 ? (v ?? 0) : (d.cobertura ?? 0)))),
      serieUnidade: "x",
      referencia: P.coberturaMin,
      laterais: [
        { label: "Mínimo", value: `${fmtDec(P.coberturaMin, 2)}x` },
        { label: "Dívida CP", value: fmtCompact(endiv.dividaCirculante) },
      ],
      detalhe:
        endiv.reclassificado > 0
          ? `Inclui ${fmtCompact(endiv.reclassificado)} reclassificados para o circulante (CPC 26.74)`
          : `Aplicações ${fmtCompact(endiv.aplicacoesContabil)} (valor contábil)`,
    });
  }

  // Composição por tipo de contrato (data-base) e ponte do bruto ao líquido
  const composicao = TIPOS_CONTRATO.map((t) => {
    const cs = f.cs.filter((c) => c.tipo === t.tipo);
    const valor = cs.reduce((s, c) => s + c.saldoCurva, 0);
    return { ...t, valor, share: f.saldo > 0 ? valor / f.saldo : 0, contratos: cs.length };
  });
  const corp = dadosCorporativosAte(db);
  const ebitda = corp.length ? corp[corp.length - 1] : null;

  return {
    meses,
    ini12,
    kpis,
    f,
    r12,
    evol,
    endiv,
    ebitda,
    composicao,
    moedaEstrangeira,
    fundos12,
    taxas12,
    covDl,
  };
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

type Modo = "cartoes" | "tabela";

export function KpisAplicacoes() {
  const { premissas: p } = usePremissas();
  const { cadastro } = useBenchmarks();
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const [modo, setModo] = useState<Modo>("cartoes");

  const d = useMemo(() => montarPainel(p, escopo, cadastro), [p, escopo, cadastro]);
  const db = p.dataBase;
  const escopoLabel = ESCOPOS.find((e) => e.value === escopo)?.label ?? "";

  const avaliados = d.kpis.filter((k) => k.state !== "neutral" && k.state !== "information");
  const cont = {
    ok: avaliados.filter((k) => k.state === "positive").length,
    atencao: avaliados.filter((k) => k.state === "critical").length,
    fora: avaliados.filter((k) => k.state === "negative").length,
  };
  const porId = (id: KpiId) => d.kpis.find((k) => k.def.id === id)!;
  const pctBruto = porId("pctBruto");
  const janela = `${fmtMonthShort(d.meses[0])} a ${fmtMonthShort(d.meses[d.meses.length - 1])}`;

  const irPara = (id: KpiId) => {
    if (modo !== "cartoes") return;
    document.getElementById(`kpi-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const exportar = () =>
    exportarExcel(
      `KPIs_Aplicacoes_${db}.xlsx`,
      [
        {
          nome: "KPIs",
          titulo: "Painel de KPIs – Aplicações financeiras (Carteira-Mestre)",
          subtitulo: `${escopoLabel} · janela de 12 meses ${janela}`,
          colunas: [
            { titulo: "Seção", largura: 22 },
            { titulo: "KPI", largura: 32 },
            { titulo: "Valor", largura: 16 },
            { titulo: "Unidade", largura: 14 },
            { titulo: "Valor (número)", tipo: "decimal", largura: 16 },
            { titulo: "Meta / limite", largura: 28 },
            { titulo: "Desvio / folga", largura: 18 },
            { titulo: "Status", largura: 24 },
            { titulo: "Tendência", largura: 22 },
            { titulo: "Escopo", largura: 14 },
            { titulo: "Fonte", largura: 10 },
          ],
          linhas: d.kpis.map((k) => [
            secaoTitulo(k.def.secao),
            k.def.nome,
            k.valorTexto,
            k.unidade,
            k.valor,
            k.metaTexto,
            `${k.desvioRotulo} ${k.desvioTexto}`,
            `${STATUS_TEXTO[k.state]} – ${k.statusTexto}`,
            k.tendencia?.texto ?? "",
            k.def.consolidado ? "Consolidado" : escopoLabel,
            k.def.origem,
          ]),
          notas: [
            "Valor (número) na unidade-base: R$; percentuais, % do CDI, p.p. e utilização em fração (0,25 = 25%); prazos em dias; duration em anos; HHI em pontos; múltiplos em x; enquadramento em nº de regras.",
            `Contagem: ${cont.ok} KPIs na meta, ${cont.atencao} em atenção e ${cont.fora} fora da meta. KPIs de aplicações × dívida são sempre consolidados.`,
            "Séries de 12 fins de mês calculadas com as premissas da data-base (histórico até a data-base); o próximo come-cotas é projeção com o último dado disponível.",
          ],
        },
        {
          nome: "Séries 12 meses",
          titulo: "Séries dos micrográficos – 12 fins de mês",
          subtitulo: `${escopoLabel} · DL/EBITDA em apurações trimestrais`,
          colunas: [
            { titulo: "KPI", largura: 32 },
            { titulo: "Unidade da série", largura: 22 },
            ...d.meses.map((m) => ({ titulo: fmtMonthShort(m), tipo: "decimal" as const, largura: 11 })),
          ],
          linhas: d.kpis.map((k) => {
            const porMes = d.meses.map((m) => {
              const rot = fmtMonthShort(m);
              const trimestre = k.def.id === "dlEbitda" ? fmtQuarter(m) : null;
              const ponto = k.def.id === "dlEbitda" ? k.serie.find((s) => s.x === trimestre && ["03", "06", "09", "12"].includes(m.slice(5, 7))) : k.serie.find((s) => s.x === rot);
              return ponto ? ponto.y : null;
            });
            return [k.def.nome, k.serieUnidade, ...porMes];
          }),
        },
        {
          nome: "Definições",
          titulo: "Definições dos KPIs: fórmula, meta, regra de status e fonte",
          colunas: [
            { titulo: "KPI", largura: 32 },
            { titulo: "Fórmula", largura: 70 },
            { titulo: "Unidade", largura: 14 },
            { titulo: "Meta / limite", largura: 50 },
            { titulo: "Tipo", largura: 9 },
            { titulo: "Regra de status", largura: 70 },
            { titulo: "Micrográfico", largura: 44 },
            { titulo: "Fonte", largura: 10 },
          ],
          linhas: DEFINICOES.map((x) => [x.nome, x.formula, x.unidade, x.meta, x.tipo === "max" ? "Máximo" : "Mínimo", x.regra, x.serie, x.origem]),
        },
      ],
      db,
    );

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label={escopo === "todas" ? "Saldo consolidado" : "Saldo da empresa"} value={fmtCompact(d.f.saldo)} sub={`${d.f.cs.length} contratos · ${escopo === "todas" ? "consolidado" : `empresa ${escopo}`}`} />
          <HeaderKpi
            label="% do CDI 12m"
            value={`${pctBruto.valorTexto}%`}
            state={pctBruto.state}
            sub={`Benchmark ${pct1(d.r12.bmk)} · ${pctBruto.statusTexto.toLowerCase()}`}
          />
          <HeaderKpi
            label="KPIs na meta"
            value={`${cont.ok}/${avaliados.length}`}
            state={cont.ok === avaliados.length ? "positive" : cont.fora ? "negative" : "critical"}
            sub={`${cont.atencao} em atenção`}
          />
          <HeaderKpi label="Alertas" value={String(cont.fora)} state={cont.fora ? "negative" : "positive"} sub="KPIs fora da meta ou do limite" />
        </>
      }
      headerExtra={
        <div className="flex flex-col md:flex-row md:items-end gap-3 md:gap-6 no-print">
          <FilterField label="Empresa" className="w-full md:w-80 shrink-0">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
          </FilterField>
          <p className="text-[13px] text-label leading-snug md:flex-1 md:pb-2">
            Janela de 12 meses: {janela} · séries de 12 fins de mês com as premissas da data-base · aplicações × dívida sempre consolidado
          </p>
          <SegmentedButton
            value={modo}
            onChange={setModo}
            className="self-start md:self-auto md:mb-0.5"
            items={[
              { value: "cartoes", label: "Cartões", icon: <LayoutGrid className="w-3.5 h-3.5" /> },
              { value: "tabela", label: "Tabela", icon: <Table2 className="w-3.5 h-3.5" /> },
            ]}
          />
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <Card
          className="lg:col-span-2 xl:col-span-3"
          title="Scorecard"
          subtitle={`${avaliados.length} KPIs com meta ou limite · ${escopoLabel} · data-base ${fmtDate(db)}`}
        >
          <div className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-5 items-center">
            <div className="flex items-center gap-5">
              <DonutStatus ok={cont.ok} atencao={cont.atencao} fora={cont.fora} />
              <ul className="space-y-2">
                <li>
                  <ObjectStatus state="positive">{cont.ok} na meta</ObjectStatus>
                </li>
                <li>
                  <ObjectStatus state="critical">{cont.atencao} em atenção</ObjectStatus>
                </li>
                <li>
                  <ObjectStatus state="negative">{cont.fora} fora da meta</ObjectStatus>
                </li>
              </ul>
            </div>
            <div className="space-y-2 min-w-0 md:border-l md:border-line-soft md:pl-8">
              {SECOES_KPI.map((s) => (
                <div key={s.id} className="grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] gap-x-3 gap-y-1 items-start">
                  <div className="text-[13px] font-semibold text-text leading-6 whitespace-nowrap">
                    {s.numero ? <span className="text-label font-normal mr-1">{s.numero}.</span> : null}
                    {s.titulo}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.kpis
                      .filter((k) => k.def.secao === s.id)
                      .map((k) => (
                        <button
                          key={k.def.id}
                          type="button"
                          onClick={() => irPara(k.def.id)}
                          title={`${k.def.nome}: ${k.valorTexto} ${k.unidade} · ${k.statusTexto}`}
                          className={clsx("rounded-md", modo === "cartoes" ? "cursor-pointer hover:brightness-95" : "cursor-default")}
                        >
                          <ObjectStatus state={k.state} inverted>
                            {k.def.curto}
                          </ObjectStatus>
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
        <CartaoKpi k={porId("enquadramento")} />
      </div>

      {modo === "tabela" ? (
        <TabelaKpis kpis={d.kpis} />
      ) : (
        <>
          <Secao id="resultado">
            {(["saldo", "rendBruto", "rendLiquido"] as KpiId[]).map((id) => (
              <CartaoKpi key={id} k={porId(id)} />
            ))}
            <PainelCard
              titulo="Composição por tipo de contrato"
              subtitulo={`Saldo bruto em ${fmtDate(db)} · (nº de contratos)`}
              rota="/carteira-mestre"
              origem="CM"
              rodape={`Moeda estrangeira: ${fmtCompact(d.moedaEstrangeira)} (${fmtPct(d.f.saldo > 0 ? d.moedaEstrangeira / d.f.saldo : 0, 1)})`}
            >
              <div className="flex h-3 rounded-full overflow-hidden bg-[#e5e5e5]" aria-hidden>
                {d.composicao
                  .filter((c) => c.valor > 0)
                  .map((c) => (
                    <div key={c.tipo} style={{ width: `${c.share * 100}%`, backgroundColor: c.cor }} title={`${c.tipo}: ${fmtPct(c.share, 1)}`} />
                  ))}
              </div>
              <ul className="mt-3.5 space-y-2">
                {d.composicao.map((c) => (
                  <li key={c.tipo} className="flex items-center gap-2 text-[13px] min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.cor }} />
                    <Link to={c.rota} className="text-link hover:underline truncate flex-1 min-w-0">
                      {c.curto}
                      <span className="text-label"> ({c.contratos})</span>
                    </Link>
                    <span className="tabular font-semibold text-text whitespace-nowrap">{fmtCompact(c.valor)}</span>
                    <span className="tabular text-label w-12 text-right shrink-0">{fmtPct(c.share, 1)}</span>
                  </li>
                ))}
              </ul>
            </PainelCard>
          </Secao>

          <Secao id="rentabilidade">
            {(["pctBruto", "pctLiquido", "real", "excesso"] as KpiId[]).map((id) => (
              <CartaoKpi key={id} k={porId(id)} />
            ))}
          </Secao>

          <Secao id="liquidez">
            {(["liquidez", "prazo", "venc90", "duration"] as KpiId[]).map((id) => (
              <CartaoKpi key={id} k={porId(id)} />
            ))}
          </Secao>

          <Secao id="risco">
            {(["hhi", "limiteGrupo", "cambial", "credito"] as KpiId[]).map((id) => (
              <CartaoKpi key={id} k={porId(id)} />
            ))}
          </Secao>

          <Secao id="custos">
            {(["carga", "taxas", "comeCotas"] as KpiId[]).map((id) => (
              <CartaoKpi key={id} k={porId(id)} />
            ))}
            <PainelCard
              titulo="Do bruto ao líquido – 12 meses"
              subtitulo={`Rendimentos de ${janela} · R$`}
              rota="/r03-rentabilidade"
              origem="R03"
              rodape={`Taxas de adm./performance dos fundos (${fmtCompact(d.fundos12)}) já descontadas na cota`}
            >
              <Ponte
                base={d.r12.rend}
                linhas={[
                  { rotulo: "Rendimento bruto", valor: d.r12.rend, cor: CHART_SEMANTIC.good, forte: true },
                  { rotulo: "(−) IR", valor: -d.r12.ir, cor: CHART_SEMANTIC.bad },
                  { rotulo: "(−) IOF", valor: -d.r12.iof, cor: CHART_SEMANTIC.bad },
                  { rotulo: "(−) Custódia e tarifas", valor: -d.r12.taxas, cor: CHART_SEMANTIC.critical },
                  { rotulo: "Rendimento líquido", valor: d.r12.liq, cor: "#0070f2", forte: true },
                ]}
              />
            </PainelCard>
          </Secao>

          <Secao id="divida" extra={<Tag>Sempre consolidado</Tag>}>
            {(["carry", "dlEbitda", "cobertura"] as KpiId[]).map((id) => (
              <CartaoKpi key={id} k={porId(id)} />
            ))}
            <PainelCard
              titulo="Dívida líquida na data-base"
              subtitulo={`Consolidado · ${fmtDate(db)} · R$`}
              rota="/r06-indicadores"
              origem="R06"
              rodape={
                d.endiv.dataCaixa && d.endiv.dataCaixa !== db
                  ? `Caixa do balancete de ${fmtDate(d.endiv.dataCaixa)} (último disponível)`
                  : `EBITDA 12m ${d.ebitda ? `(${fmtQuarter(d.ebitda.data)})` : ""}: ${d.ebitda ? fmtCompact(d.ebitda.ebitdaLTM) : "—"}`
              }
            >
              <Ponte
                base={d.endiv.dividaBruta}
                linhas={[
                  { rotulo: "Dívida bruta", valor: d.endiv.dividaBruta, cor: "#df1278", forte: true },
                  { rotulo: "(−) Caixa", valor: -d.endiv.caixa, cor: "#758ca4" },
                  { rotulo: "(−) Aplicações (contábil)", valor: -d.endiv.aplicacoesContabil, cor: "#0070f2" },
                  { rotulo: "Dívida líquida", valor: d.endiv.dividaLiquida, cor: "#8b47d7", forte: true },
                ]}
              />
            </PainelCard>
          </Secao>
        </>
      )}
    </ReportPage>
  );
}

function secaoTitulo(id: SecaoKpi): string {
  const s = SECOES_KPI.find((x) => x.id === id)!;
  return s.numero ? `${s.numero}. ${s.titulo}` : s.titulo;
}

function Secao({ id, extra, children }: { id: SecaoKpi; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="pt-2">
      <SectionTitle extra={extra}>{secaoTitulo(id)}</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">{children}</div>
    </section>
  );
}

function CartaoKpi({ k }: { k: KpiCalc }) {
  return (
    <div id={`kpi-${k.def.id}`} className="min-w-0 scroll-mt-24" title={`${k.def.formula}\nMeta: ${k.def.meta}\n${k.def.regra}`}>
      <KpiCard
        className="h-full"
        titulo={k.def.nome}
        subtitulo={k.def.resumo}
        valor={k.valorTexto}
        unidade={k.unidade}
        state={k.state === "neutral" ? "neutral" : k.state}
        tendencia={k.tendencia}
        laterais={k.laterais}
        serie={k.serie}
        referencia={k.referencia}
        status={{ state: k.state, texto: k.statusTexto }}
        rota={k.def.rota}
        origem={k.def.origem}
        detalhe={k.detalhe}
      />
    </div>
  );
}

/** Cartão auxiliar com o mesmo cabeçalho e rodapé do KpiCard */
function PainelCard({
  titulo,
  subtitulo,
  rota,
  origem,
  rodape,
  children,
}: {
  titulo: string;
  subtitulo: string;
  rota: string;
  origem: string;
  rodape?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-white rounded-[var(--radius-card)] shadow-fiori print-flat flex flex-col min-w-0">
      <header className="px-4 pt-3.5">
        <h3 className="text-[15px] font-bold text-text leading-snug">{titulo}</h3>
        <p className="text-[13px] text-label leading-snug mt-0.5">{subtitulo}</p>
      </header>
      <div className="px-4 pt-3 pb-1 flex-1">{children}</div>
      <footer className="mt-3 px-4 py-2.5 border-t border-line-soft flex items-center justify-between gap-2 min-h-[2.5rem]">
        <span className="text-xs text-label leading-snug min-w-0">{rodape}</span>
        <Link to={rota} className="text-[13px] text-link hover:underline inline-flex items-center gap-0.5 no-print whitespace-nowrap shrink-0">
          {origem}
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </footer>
    </section>
  );
}

/** Barras horizontais de uma ponte (bruto → líquido, dívida bruta → líquida), proporcionais à base */
function Ponte({ base, linhas }: { base: number; linhas: { rotulo: string; valor: number; cor: string; forte?: boolean }[] }) {
  return (
    <ul className="space-y-2.5">
      {linhas.map((l) => (
        <li key={l.rotulo} className="min-w-0">
          <div className={clsx("flex items-baseline justify-between gap-2 text-[13px]", l.forte ? "font-semibold text-text" : "text-label")}>
            <span className="truncate">{l.rotulo}</span>
            <span className="tabular whitespace-nowrap text-text">{fmtCompact(l.valor)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-[#eef0f2]">
            <div
              className="h-full rounded-full"
              style={{ width: `${base > 0 ? Math.max(1.5, Math.min(100, (Math.abs(l.valor) / base) * 100)) : 0}%`, backgroundColor: l.cor }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DonutStatus({ ok, atencao, fora }: { ok: number; atencao: number; fora: number }) {
  const total = ok + atencao + fora;
  const dados = [
    { nome: "Na meta", v: ok, cor: CHART_SEMANTIC.good },
    { nome: "Em atenção", v: atencao, cor: CHART_SEMANTIC.critical },
    { nome: "Fora da meta", v: fora, cor: CHART_SEMANTIC.bad },
  ].filter((x) => x.v > 0);
  return (
    <div className="relative w-32 h-32 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={dados} dataKey="v" nameKey="nome" innerRadius="76%" outerRadius="100%" paddingAngle={2} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
            {dados.map((x) => (
              <Cell key={x.nome} fill={x.cor} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[1.75rem] font-light leading-none tabular text-positive">{ok}</span>
        <span className="text-[11px] text-label leading-tight mt-1 text-center">
          de {total}
          <br />
          na meta
        </span>
      </div>
    </div>
  );
}

function TabelaKpis({ kpis }: { kpis: KpiCalc[] }) {
  const colunas: Column<KpiCalc>[] = [
    {
      key: "kpi",
      header: "KPI",
      minWidth: 240,
      value: (k) => k.def.nome,
      render: (k) => (
        <div title={k.def.formula}>
          <div className="font-semibold text-text">{k.def.nome}</div>
          <div className="text-xs text-label">{k.def.resumo}</div>
        </div>
      ),
    },
    { key: "secao", header: "Seção", value: (k) => SECOES_KPI.findIndex((s) => s.id === k.def.secao), render: (k) => <span className="whitespace-nowrap">{secaoTitulo(k.def.secao)}</span> },
    {
      key: "valor",
      header: "Valor",
      align: "right",
      value: (k) => k.valor,
      render: (k) => (
        <span className="whitespace-nowrap">
          <span className="font-semibold tabular text-text">{k.valorTexto}</span> <span className="text-label text-xs">{k.unidade}</span>
        </span>
      ),
    },
    { key: "meta", header: "Meta / limite", value: (k) => k.metaTexto, render: (k) => <span className="whitespace-nowrap">{k.metaTexto}</span> },
    {
      key: "desvio",
      header: "Desvio / folga",
      align: "right",
      value: (k) => k.desvioTexto,
      render: (k) => (
        <span className="whitespace-nowrap">
          <span className="text-label text-xs">{k.desvioRotulo}</span>{" "}
          <span className={clsx("tabular font-semibold", k.state === "negative" ? "text-negative" : k.state === "critical" ? "text-critical" : "text-text")}>
            {k.desvioTexto}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      value: (k) => ORDEM_ESTADO[k.state],
      render: (k) => <ObjectStatus state={k.state}>{k.statusTexto}</ObjectStatus>,
    },
    {
      key: "tendencia",
      header: "Tendência",
      value: (k) => k.tendencia?.texto ?? "",
      render: (k) => <Tendencia t={k.tendencia} />,
    },
    {
      key: "fonte",
      header: "Fonte",
      value: (k) => k.def.origem,
      render: (k) => (
        <Link to={k.def.rota} className="text-link hover:underline inline-flex items-center gap-0.5 whitespace-nowrap">
          {k.def.origem}
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      ),
    },
  ];
  return (
    <Card title="Todos os KPIs" subtitle="Valor na data-base, meta ou limite, desvio, status, tendência no mês e relatório de origem" bodyClassName="px-0 pb-0">
      <DataTable columns={colunas} rows={kpis} rowKey={(k) => k.def.id} />
    </Card>
  );
}

function Tendencia({ t }: { t?: KpiTendencia }) {
  if (!t) return <span className="text-label">—</span>;
  const Seta = t.direcao === "up" ? ArrowUpRight : t.direcao === "down" ? ArrowDownRight : ArrowRight;
  const cor = t.favoravel === null || t.direcao === "flat" ? "text-label" : t.favoravel ? "text-positive" : "text-negative";
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap text-[13px]", cor)}>
      <Seta className="w-4 h-4 shrink-0" />
      {t.texto}
    </span>
  );
}
