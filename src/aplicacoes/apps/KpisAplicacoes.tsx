import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CHART_SEMANTIC, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { FilterField, Select } from "../../shared/components/fiori/Inputs";
import {
  KpiCard,
  KpiPainel,
  KpiPlacar,
  KpiPonte,
  KpiSecao,
  KpiTabela,
  contarPlacar,
  reaisKpi,
  type KpiIndicadorLateral,
  type KpiLinha,
  type KpiModo,
  type KpiPlacarItem,
  type KpiTendencia,
} from "../../shared/components/fiori/KpiCard";
import { type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { CONTRATOS } from "../../captacoes/data/contratos";
import { indicadoresEm, reclassificadosEm } from "../../captacoes/lib/covenants";
import { posicoesDivida } from "../../captacoes/lib/divida";
import { usePremissas } from "../../shared/context/MercadoContext";
import { dadosCorporativosAte } from "../../shared/data/corporativo";
import { premissasNaDataBase, type PremissasMercado as Premissas } from "../../shared/data/mercado";
import { addDays, diffDays, fmtDate, fmtMonthShort, fmtQuarter, lastMonthEnds, previousYearEnd } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtCompact, fmtDec, fmtInt, fmtPct, plural } from "../../shared/lib/format";
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
  LIMITES_POLITICA,
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

const SECOES_KPI: { id: SecaoKpi; numero: number; titulo: string; periodo: string }[] = [
  { id: "politica", numero: 0, titulo: "Política de investimentos", periodo: "Fim do mês" },
  { id: "resultado", numero: 1, titulo: "Tamanho e resultado", periodo: "Saldo no fim do mês · rendimentos dos últimos 12 meses" },
  { id: "rentabilidade", numero: 2, titulo: "Rentabilidade", periodo: "Janela de 12 meses · micrográficos mês a mês" },
  { id: "liquidez", numero: 3, titulo: "Liquidez e prazo", periodo: "Mensal · 12 fins de mês" },
  { id: "risco", numero: 4, titulo: "Risco e concentração", periodo: "Mensal · 12 fins de mês" },
  { id: "custos", numero: 5, titulo: "Custos e tributos", periodo: "Janela de 12 meses · come-cotas no ano" },
  { id: "divida", numero: 6, titulo: "Aplicações × dívida", periodo: "Sempre consolidado · mensal · DL/EBITDA trimestral" },
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

/** Origem da meta ou do limite */
type FonteMeta = "politica" | "politicaFin" | "benchmark" | "comite" | "covenant";

const FONTE_META: Record<FonteMeta, { texto: string; palavra: "meta" | "limite" }> = {
  politica: { texto: "política de investimentos", palavra: "limite" },
  politicaFin: { texto: "política financeira", palavra: "limite" },
  benchmark: { texto: "benchmark cadastrado", palavra: "meta" },
  comite: { texto: "meta do comitê (fictícia)", palavra: "meta" },
  covenant: { texto: "covenant contratual", palavra: "limite" },
};

interface DefinicaoKpi {
  id: KpiId;
  secao: SecaoKpi;
  nome: string;
  /** rótulo curto do placar */
  curto: string;
  /** fórmula resumida (subtítulo do cartão) */
  resumo: string;
  /** fórmula completa (tabela, exportação e dica do cartão) */
  formula: string;
  unidade: string;
  /** meta ou limite, por extenso */
  meta: string;
  fonte: FonteMeta;
  tipo: "max" | "min";
  /** regra de status (faixa de atenção e fora da meta) */
  regra: string;
  serie: string;
  /** período do valor ("fim do mês", "12 meses"…) */
  periodicidade: string;
  rota: string;
  /** relatório de origem, no formato do link ("R05 · Evolução") */
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
  hhiLimite: 1500,
};

/** Cobertura de curto prazo: limite da política financeira interna (o mesmo do R06 e do painel de Captações) */
const LIM_COBERTURA = LIMITES_POLITICA.find((l) => l.id === "liquidez")!;

const REGRA_BMK =
  "Na meta: em linha (±0,5 p.p.) ou acima do benchmark · Atenção: até 2,0 p.p. abaixo · Fora: mais de 2,0 p.p. abaixo";

const ORIGEM = {
  cm: "Carteira-Mestre",
  bmk: "Benchmark",
  r03: "R03 · Rentabilidade",
  r05: "R05 · Evolução",
  r06: "R06 · Endividamento",
  r07: "R07 · Concentração",
  r08: "R08 · Tesouro Direto",
  r09: "R09 · Fundos",
  r11: "R11 · Moeda × tipo",
};

const DEFINICOES: DefinicaoKpi[] = [
  {
    id: "enquadramento",
    secao: "politica",
    nome: "Enquadramento na política",
    curto: "Enquadramento",
    resumo: "Regras e limites por grupo não excedidos",
    formula:
      "Regras da política de investimentos + limites por grupo econômico (rating) não excedidos ÷ total de regras e limites (R07); cotas de fundos ficam fora dos limites por grupo (patrimônio segregado, CVM 175) e têm limite próprio de 20%",
    unidade: "regras",
    meta: "Todas as regras e limites enquadrados",
    fonte: "politica",
    tipo: "min",
    regra: "Na meta: todas enquadradas, nenhuma em atenção · Atenção: alguma ≥ 80% do limite (ou ≤ 120% do mínimo) · Fora: alguma excedida",
    serie: "% de regras e limites enquadrados no fim de cada mês",
    periodicidade: "fim do mês",
    rota: "/r07-concentracao",
    origem: ORIGEM.r07,
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
    fonte: "politicaFin",
    tipo: "min",
    regra: "Atenção: até 120% da reserva mínima · Fora: abaixo da reserva mínima",
    serie: "Saldo bruto no fim de cada mês (R$ mi)",
    periodicidade: "fim do mês",
    rota: "/carteira-mestre",
    origem: ORIGEM.cm,
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
    fonte: "benchmark",
    tipo: "min",
    regra: REGRA_BMK,
    serie: "Rendimento bruto de cada mês (R$ mi – R05)",
    periodicidade: "12 meses",
    rota: "/r05-evolucao",
    origem: ORIGEM.r05,
  },
  {
    id: "rendLiquido",
    secao: "resultado",
    nome: "Rendimento líquido 12 meses",
    curto: "Rend. líquido",
    resumo: "Bruto − IR − IOF − custódia e tarifas",
    formula:
      "Rendimento bruto − IR (variação do IR acumulado) − IOF realizado − custódia de títulos e tarifas de time deposits dos últimos 12 meses (taxas dos fundos já estão na cota)",
    unidade: "R$",
    meta: "≥ rendimento do benchmark × (1 − 20% de carga tributária-meta)",
    fonte: "benchmark",
    tipo: "min",
    regra: `${REGRA_BMK} (sobre o % do CDI líquido)`,
    serie: "Rendimento líquido de cada mês (R$ mi)",
    periodicidade: "12 meses",
    rota: "/r03-rentabilidade",
    origem: ORIGEM.r03,
  },
  {
    id: "pctBruto",
    secao: "rentabilidade",
    nome: "% do CDI bruto 12 meses",
    curto: "% CDI bruto",
    resumo: "Rendimento ÷ (capital base × CDI do período)",
    formula: "Rendimento bruto ÷ Σ (capital base de cada contrato × CDI do período) – mesmo método do R03 e do R05 (coluna 12 meses)",
    unidade: "% do CDI",
    meta: "≥ benchmark da carteira (cadastro de benchmark, regra vigente em cada dia)",
    fonte: "benchmark",
    tipo: "min",
    regra: REGRA_BMK,
    serie: "% do CDI de cada mês sobre o saldo médio (R05)",
    periodicidade: "12 meses",
    rota: "/r05-evolucao",
    origem: ORIGEM.r05,
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
    fonte: "benchmark",
    tipo: "min",
    regra: REGRA_BMK,
    serie: "% do CDI líquido de cada mês",
    periodicidade: "12 meses",
    rota: "/r03-rentabilidade",
    origem: ORIGEM.r03,
  },
  {
    id: "real",
    secao: "rentabilidade",
    nome: "Rentabilidade real 12 meses",
    curto: "Real",
    resumo: "Líquida ÷ (1 + IPCA 12m) − 1",
    formula: "(1 + rentabilidade líquida sobre o capital médio) ÷ (1 + IPCA 12 meses importado do SAP) − 1 – mesmo método do R03",
    unidade: "% a.a.",
    meta: "≥ 4,00% a.a. acima do IPCA",
    fonte: "comite",
    tipo: "min",
    regra: "Atenção: entre 4,00% e 5,00% · Fora: abaixo de 4,00%",
    serie: "Rentabilidade líquida do mês anualizada, descontado o IPCA 12 meses",
    periodicidade: "12 meses",
    rota: "/r03-rentabilidade",
    origem: ORIGEM.r03,
  },
  {
    id: "excesso",
    secao: "rentabilidade",
    nome: "Excesso sobre o benchmark",
    curto: "Excesso",
    resumo: "Realizado − rendimento do benchmark (12m)",
    formula: "Rendimento realizado − rendimento que o benchmark cadastrado teria gerado sobre o mesmo capital, capitalizado dia a dia (12 meses); em p.p. do CDI: % do CDI realizado − benchmark",
    unidade: "R$",
    meta: "≥ 0 (em linha: ±0,5 p.p. do CDI)",
    fonte: "benchmark",
    tipo: "min",
    regra: REGRA_BMK,
    serie: "Excesso de cada mês (R$ mil – R05)",
    periodicidade: "12 meses",
    rota: "/benchmark",
    origem: ORIGEM.bmk,
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
    fonte: "politica",
    tipo: "min",
    regra: "Atenção: até 24% (120% do mínimo) · Fora: abaixo de 20%",
    serie: "% da carteira no fim de cada mês",
    periodicidade: "fim do mês",
    rota: "/r07-concentracao",
    origem: ORIGEM.r07,
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
    fonte: "comite",
    tipo: "max",
    regra: "Atenção: a partir de 576 dias (80% do limite) · Fora: acima de 720 dias",
    serie: "Prazo médio no fim de cada mês (dias)",
    periodicidade: "fim do mês",
    rota: "/carteira-mestre",
    origem: ORIGEM.cm,
  },
  {
    id: "venc90",
    secao: "liquidez",
    nome: "Vencimentos em 90 dias",
    curto: "Venc. 90 dias",
    resumo: "Saldo dos contratos que vencem em até 90 dias",
    formula: "Saldo bruto dos contratos (renda fixa, títulos públicos e time deposits) que vencem nos próximos 90 dias ÷ saldo bruto",
    unidade: "R$",
    meta: "≤ 30% da carteira (concentração de vencimentos – risco de reinvestimento)",
    fonte: "comite",
    tipo: "max",
    regra: "Atenção: a partir de 24% da carteira · Fora: acima de 30%",
    serie: "Saldo a vencer em 90 dias no fim de cada mês (R$ mi)",
    periodicidade: "fim do mês",
    rota: "/carteira-mestre",
    origem: ORIGEM.cm,
  },
  {
    id: "duration",
    secao: "liquidez",
    nome: "Duration dos títulos prefixados e IPCA (risco de taxa)",
    curto: "Duration",
    resumo: "Macaulay, ponderada pelo saldo a mercado",
    formula:
      "Duration de Macaulay (anos úteis) dos títulos prefixados (LTN, NTN-F) e IPCA (NTN-B Principal, NTN-B), ponderada pelo saldo a mercado (taxas indicativas ANBIMA); LFT fora – pós-fixada, reprecificada diariamente pela Selic (duration de taxa zero)",
    unidade: "anos",
    meta: "≤ 4,0 anos (risco de mercado)",
    fonte: "comite",
    tipo: "max",
    regra: "Atenção: a partir de 3,2 anos · Fora: acima de 4,0 anos",
    serie: "Duration no fim de cada mês (anos)",
    periodicidade: "fim do mês",
    rota: "/r08-tesouro",
    origem: ORIGEM.r08,
  },
  {
    id: "hhi",
    secao: "risco",
    nome: "Concentração por grupo (HHI)",
    curto: "HHI",
    resumo: "Σ participações² por grupo econômico",
    formula:
      "Índice Herfindahl-Hirschman: Σ (participação de cada grupo econômico na carteira, em %)², de 0 a 10.000 – cotas de fundos fora (patrimônio segregado, CVM 175; limite próprio de 20%)",
    unidade: "pontos",
    meta: "< 1.500 (baixa concentração)",
    fonte: "comite",
    tipo: "max",
    regra: "Atenção: 1.500 a 2.500 (moderada) · Fora: acima de 2.500 (alta)",
    serie: "HHI no fim de cada mês",
    periodicidade: "fim do mês",
    rota: "/r07-concentracao",
    origem: ORIGEM.r07,
  },
  {
    id: "limiteGrupo",
    secao: "risco",
    nome: "Maior utilização de limite",
    curto: "Limite por grupo",
    resumo: "Participação do grupo ÷ limite por rating",
    formula:
      "Maior participação de um grupo econômico na carteira ÷ limite da política pelo rating (Soberano sem limite; AAA 25%; AA 15%; A 5%) – cotas de fundos fora (patrimônio segregado, CVM 175), com limite próprio de 20%",
    unidade: "% do limite",
    meta: "≤ 100% do limite",
    fonte: "politica",
    tipo: "max",
    regra: "Atenção: a partir de 80% do limite · Fora: acima de 100%",
    serie: "Maior utilização no fim de cada mês (%)",
    periodicidade: "fim do mês",
    rota: "/r07-concentracao",
    origem: ORIGEM.r07,
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
    fonte: "politica",
    tipo: "max",
    regra: "Atenção: a partir de 8% · Fora: acima de 10%",
    serie: "% da carteira no fim de cada mês",
    periodicidade: "fim do mês",
    rota: "/r11-moeda-tipo",
    origem: ORIGEM.r11,
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
    fonte: "politica",
    tipo: "max",
    regra: "Atenção: a partir de 16% · Fora: acima de 20%",
    serie: "% da carteira no fim de cada mês",
    periodicidade: "fim do mês",
    rota: "/r07-concentracao",
    origem: ORIGEM.r07,
  },
  {
    id: "carga",
    secao: "custos",
    nome: "Carga tributária efetiva 12m",
    curto: "Carga tributária",
    resumo: "(IR + IOF) ÷ rendimento bruto",
    formula: "(IR + IOF realizado) ÷ rendimento bruto dos últimos 12 meses (IR regressivo, IRPJ/CSLL nos time deposits, isenções de LCI/LCA)",
    unidade: "%",
    meta: "≤ 20% do rendimento bruto",
    fonte: "comite",
    tipo: "max",
    regra: "Atenção: a partir de 18% · Fora: acima de 20%",
    serie: "Carga acumulada na janela até cada fim de mês (%)",
    periodicidade: "12 meses",
    rota: "/r03-rentabilidade",
    origem: ORIGEM.r03,
  },
  {
    id: "taxas",
    secao: "custos",
    nome: "Taxas e tarifas 12 meses",
    curto: "Taxas",
    resumo: "Fundos (adm./perf.), custódia e tarifas de TD",
    formula:
      "Taxas de administração e performance dos fundos + custódia B3 e taxa do agente dos títulos + tarifas de time deposits (12 meses) ÷ saldo médio, em bps a.a.",
    unidade: "R$ · bps a.a.",
    meta: "≤ 25 bps a.a. sobre o saldo médio",
    fonte: "comite",
    tipo: "max",
    regra: "Atenção: a partir de 20 bps · Fora: acima de 25 bps",
    serie: "Custo do mês em bps a.a. sobre o saldo médio",
    periodicidade: "12 meses",
    rota: "/r09-fundos",
    origem: ORIGEM.r09,
  },
  {
    id: "comeCotas",
    secao: "custos",
    nome: "Come-cotas antecipado no ano",
    curto: "Come-cotas",
    resumo: "IR recolhido por redução de cotas desde 1º/jan",
    formula: "IR antecipado no come-cotas (último dia útil de maio e de novembro) desde 1º de janeiro, sem saída de caixa; status pela participação dos fundos na carteira",
    unidade: "R$",
    meta: "Fundos sujeitos a come-cotas ≤ 20% da carteira (política de investimentos)",
    fonte: "politica",
    tipo: "max",
    regra: "Atenção: fundos a partir de 16% da carteira · Fora: acima de 20%",
    serie: "Come-cotas de cada mês (R$ mil)",
    periodicidade: "no ano",
    rota: "/r09-fundos",
    origem: ORIGEM.r09,
  },
  {
    id: "carry",
    secao: "divida",
    nome: "Carry (carrego): aplicações em R$ × dívida",
    curto: "Carry",
    resumo: "Taxa média das aplicações em R$ − custo da dívida",
    formula:
      "Taxa bruta média das aplicações em R$ (cenário das Premissas, ponderada pelo saldo bruto) − custo médio ponderado da dívida (custo amortizado); time deposits e fundo cambial ficam fora (taxa em moeda estrangeira não comparável ao custo em R$)",
    unidade: "p.p.",
    meta: "≥ −1,50 p.p. (custo de carregamento tolerado)",
    fonte: "comite",
    tipo: "min",
    regra: "Atenção: entre −1,50 e −0,75 p.p. · Fora: abaixo de −1,50 p.p.",
    serie: "Carry no fim de cada mês, com as premissas daquela data (p.p. – igual ao R06 da data)",
    periodicidade: "fim do mês",
    rota: "/r06-indicadores",
    origem: ORIGEM.r06,
    consolidado: true,
  },
  {
    id: "dlEbitda",
    secao: "divida",
    nome: "Dívida líquida / EBITDA",
    curto: "DL/EBITDA",
    resumo: "(Dívida − caixa − aplicações) ÷ EBITDA 12m",
    formula: "(Dívida bruta − caixa − aplicações pelo valor contábil) ÷ EBITDA dos últimos 12 meses, no fim do trimestre – covenant das debêntures e da CCB",
    unidade: "x",
    meta: "≤ 3,00x (covenant contratual)",
    fonte: "covenant",
    tipo: "max",
    regra: "Atenção: a partir de 2,50x · Fora: acima de 3,00x",
    serie: "Apurações trimestrais do covenant",
    periodicidade: "trimestral",
    rota: "/r06-indicadores",
    origem: ORIGEM.r06,
    consolidado: true,
  },
  {
    id: "cobertura",
    secao: "divida",
    nome: "Cobertura de curto prazo",
    curto: "Cobertura CP",
    resumo: "(Caixa + aplicações circulantes) ÷ dívida circulante",
    formula:
      "(Caixa do último balancete + aplicações circulantes pelo valor contábil) ÷ dívida circulante pelo custo amortizado (inclui a reclassificação do CPC 26, item 74, se houver) – mesma fórmula do R06 e do painel de Captações",
    unidade: "x",
    meta: `≥ ${fmtDec(LIM_COBERTURA.limite, 2)}x (política financeira)`,
    fonte: "politicaFin",
    tipo: "min",
    regra: `Atenção: até ${fmtDec(LIM_COBERTURA.alerta, 2)}x · Fora: abaixo de ${fmtDec(LIM_COBERTURA.limite, 2)}x`,
    serie: "Cobertura no fim de cada mês, com as premissas daquela data (x)",
    periodicidade: "fim do mês",
    rota: "/r06-indicadores",
    origem: ORIGEM.r06,
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

/** Desvio em p.p. do CDI contra o benchmark: tolerância de ±0,5 p.p. (mesma do cadastro de benchmark) */
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

/** Variação contra o período anterior ("+0,4 p.p. vs fev/26"), com a seta favorável ou não */
function tendencia(d: number | null, f: FmtDelta, melhor: "up" | "down" | null, rotulo: string): KpiTendencia | undefined {
  if (d === null || !Number.isFinite(d)) return undefined;
  const { texto, zero } = comSinal(d, f);
  if (zero) return { texto: `estável ${rotulo}`, direcao: "flat", favoravel: null };
  const direcao = d > 0 ? "up" : "down";
  return { texto: `${texto} ${rotulo}`, direcao, favoravel: melhor === null ? null : (direcao === "up") === (melhor === "up") };
}

const PP: FmtDelta = { escala: 100, casas: 1, sufixo: " p.p." };
const PP2: FmtDelta = { escala: 100, casas: 2, sufixo: " p.p." };
const X2: FmtDelta = { escala: 1, casas: 2, sufixo: "x" };
const ANO: FmtDelta = { escala: 1, casas: 2, sufixo: " ano" };
const PCT: FmtDelta = { escala: 100, casas: 1, sufixo: "%" };

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
  /** data ou janela do valor (2ª linha na tabela) */
  dataRef: string;
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
  /** tabela e placar: valor na mesma grandeza da meta, quando o cartão mostra outra (R$ no detalhe) */
  tabela?: { valor: string; ordem: number; detalhe: string; meta: string };
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
  /** duration de taxa dos títulos prefixados e IPCA (LFT fora) */
  duration: number | null;
  titulos: number;
  mercadoTitulos: number;
  mercadoLFT: number;
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
  const posicoes = TITULOS.filter((t) => escopo === "todas" || t.empresa === escopo)
    .map((t) => ({ t, x: posicaoTitulo(t, data, p) }))
    .filter((y) => y.x.ativo);
  // LFT: pós-fixada, reprecificada diariamente pela Selic – sem risco de taxa (duration de taxa zero)
  const tits = posicoes.filter((y) => y.t.tipo !== "LFT");
  const mercado = tits.reduce((s, y) => s + y.x.saldoMercado, 0);
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
    duration: mercado > 0 ? tits.reduce((s, y) => s + y.x.duration * y.x.saldoMercado, 0) / mercado : null,
    titulos: tits.length,
    mercadoTitulos: mercado,
    mercadoLFT: posicoes.filter((y) => y.t.tipo === "LFT").reduce((s, y) => s + y.x.saldoMercado, 0),
  };
}

/**
 * Aplicações × dívida no fim do mês – sempre consolidado e com as premissas daquela data (a mesma base do R06 com a
 * data-base no mês): carry das aplicações em R$ e cobertura de curto prazo.
 */
function fotoDivida(data: string) {
  const pm = premissasNaDataBase(data);
  const aplic = contratosMestre(data, pm);
  const aplicCirculantes = aplic.filter((c) => c.circulante).reduce((s, c) => s + c.valorContabil, 0);
  const dividaCirculante = posicoesDivida(CONTRATOS, data, pm, reclassificadosEm(data)).reduce((s, x) => s + x.circulante, 0);
  const corp = dadosCorporativosAte(data);
  const ultimo = corp.length ? corp[corp.length - 1] : null;
  const caixa = ultimo?.caixa ?? 0;
  return {
    data,
    caixa,
    dataCaixa: ultimo?.data ?? null,
    aplicCirculantes,
    dividaCirculante,
    cobertura: dividaCirculante > 0 ? (caixa + aplicCirculantes) / dividaCirculante : null,
    carry: calcularCarry(aplic, pm),
  };
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
  const vsMes = `vs ${fmtMonthShort(mesAnt)}`;
  const tend = (d: number | null, f: FmtDelta, melhor: "up" | "down" | null) => tendencia(d, f, melhor, vsMes);
  const x = meses.map(fmtMonthShort);
  const noEscopo = (empresa: string) => escopo === "todas" || empresa === escopo;
  const serie = (ys: number[]) => ys.map((y, i) => ({ x: x[i], y }));
  const ultimo = <T,>(xs: T[]) => xs[xs.length - 1];
  const penultimo = <T,>(xs: T[]) => xs[xs.length - 2];
  const janela = `${fmtMonthShort(meses[0])} a ${fmtMonthShort(db)}`;
  const naData = fmtDate(db);

  // Fotografias de fim de mês (Carteira-Mestre) e aplicações × dívida (consolidado, premissas de cada data)
  const fotos = meses.map((m) => fotografar(m, p, escopo));
  const f = ultimo(fotos);
  const fAnt = penultimo(fotos);
  const dividas = meses.map((m) => fotoDivida(m));
  const dv = ultimo(dividas);
  const dAnt = penultimo(dividas);
  const endiv = endividamentoEm(p);
  const carry = dv.carry;

  // Fluxos: evolução mensal (R05), rentabilidade 12 meses (R03/benchmark) e a janela até o mês anterior (tendência)
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
  // (o motor acumula as taxas até a data ou, se o fundo já foi resgatado, até o resgate)
  const taxasFundoAte = (fu: Fundo, d: string) => (d < fu.dataAplicacao ? 0 : posicaoFundo(fu, d, p).taxas);
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
  const apuracaoDl = covDl.dataApuracao ? indicadoresEm(covDl.dataApuracao) : null;

  const regra = (fo: Foto, id: string) => fo.politica.find((r) => r.id === id)!;
  const moedaEstrangeira = f.cs.filter((c) => c.moeda !== "BRL").reduce((s, c) => s + c.saldoCurva, 0);
  const kpis: KpiCalc[] = [];
  const add = (id: KpiId, k: Omit<KpiCalc, "def">) => kpis.push({ def: DEF[id], ...k });

  // --- Política: enquadramento (R07) ---
  {
    const exc = f.excedidas.length;
    const excAnt = fAnt.excedidas.length;
    const at = f.emAtencao.length;
    const state: ValueState = exc ? "negative" : at ? "critical" : "positive";
    // a série mostra o % enquadrado: menos regras excedidas = seta para cima (favorável)
    const t: KpiTendencia =
      exc === excAnt
        ? { texto: `estável ${vsMes}`, direcao: "flat", favoravel: null }
        : { texto: `${excAnt} → ${exc} ${exc === 1 ? "excedida" : "excedidas"} ${vsMes}`, direcao: exc < excAnt ? "up" : "down", favoravel: exc < excAnt };
    add("enquadramento", {
      valor: f.enquadradas,
      valorTexto: `${f.enquadradas}/${f.totalRegras}`,
      unidade: "enquadradas",
      dataRef: naData,
      metaTexto: `${f.totalRegras}/${f.totalRegras}`,
      desvioRotulo: "Desvio",
      desvioTexto: exc ? plural(exc, "excedida", "excedidas") : "nenhuma excedida",
      state,
      statusTexto: exc ? plural(exc, "desenquadrada", "desenquadradas") : at ? `${at} em atenção` : "Enquadrado",
      tendencia: t,
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
    const dm = reaisKpi(f.saldo);
    add("saldo", {
      valor: f.saldo,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      dataRef: naData,
      metaTexto: `≥ ${fmtCompact(meta)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(f.saldo - meta, "brl").texto,
      state,
      statusTexto: state === "negative" ? "Abaixo da reserva" : STATUS_TEXTO[state],
      tendencia: tend(fAnt.saldo > 0 ? f.saldo / fAnt.saldo - 1 : null, PCT, "up"),
      serie: serie(fotos.map((fo) => fo.saldo / 1e6)),
      serieUnidade: "R$ mi",
      referencia: meta / 1e6,
      laterais: [
        { label: "Reserva mínima", value: fmtCompact(meta) },
        { label: "Folga", value: comSinal(f.saldo - meta, "brl").texto, state },
      ],
      detalhe: `${plural(f.cs.length, "contrato", "contratos")} · valor contábil (CPC 48) ${fmtCompact(f.contabil)}`,
    });
  }
  {
    const cmp = r12.cmp!;
    const d = r12.pctBruto - r12.bmk;
    const state = estadoBenchmark(d);
    const dm = reaisKpi(r12.rend);
    const desvio = comSinal(cmp.rendBenchmark > 0 ? r12.rend / cmp.rendBenchmark - 1 : 0, PCT).texto;
    add("rendBruto", {
      valor: r12.rend,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      dataRef: janela,
      metaTexto: `≥ ${fmtCompact(cmp.rendBenchmark)}`,
      desvioRotulo: "Desvio",
      desvioTexto: desvio,
      state,
      statusTexto: SITUACAO_TEXTO[situacaoBenchmark(r12.pctBruto, r12.bmk)],
      tendencia: tend(r12.rend - rAnt.rend, "brl", "up"),
      serie: serie(evol.map((m) => m.rendimentos / 1e6)),
      serieUnidade: "R$ mi",
      laterais: [
        { label: "Benchmark", value: fmtCompact(cmp.rendBenchmark) },
        { label: "Desvio", value: desvio, state },
      ],
      detalhe: `${pct1(r12.pctBruto)} do CDI × benchmark de ${pct1(r12.bmk)} (12 meses)`,
    });
  }
  {
    const meta = (r12.cmp?.rendBenchmark ?? 0) * (1 - P.cargaMax);
    const state = estadoBenchmark(r12.pctLiq - r12.metaLiq);
    const dm = reaisKpi(r12.liq);
    const desvio = comSinal(meta > 0 ? r12.liq / meta - 1 : 0, PCT).texto;
    add("rendLiquido", {
      valor: r12.liq,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      dataRef: janela,
      metaTexto: `≥ ${fmtCompact(meta)}`,
      desvioRotulo: "Desvio",
      desvioTexto: desvio,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tend(r12.liq - rAnt.liq, "brl", "up"),
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
      valorTexto: pct1(r12.pctBruto),
      unidade: "do CDI",
      dataRef: janela,
      metaTexto: `≥ ${pct1(r12.bmk)}`,
      desvioRotulo: "Desvio",
      desvioTexto: comSinal(d, PP).texto,
      state,
      statusTexto: SITUACAO_TEXTO[situacaoBenchmark(r12.pctBruto, r12.bmk)],
      tendencia: tend(r12.pctBruto - rAnt.pctBruto, PP, "up"),
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
      valorTexto: pct1(r12.pctLiq),
      unidade: "do CDI",
      dataRef: janela,
      metaTexto: `≥ ${pct1(r12.metaLiq)}`,
      desvioRotulo: "Desvio",
      desvioTexto: comSinal(d, PP).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tend(r12.pctLiq - rAnt.pctLiq, PP, "up"),
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
      valorTexto: fmtPct(r12.realAA, 2),
      unidade: "a.a.",
      dataRef: janela,
      metaTexto: `≥ ${fmtPct(P.realMin, 2)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(r12.realAA - P.realMin, PP2).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tend(r12.realAA - rAnt.realAA, PP2, "up"),
      serie: serie(mensal.map((m) => m.realAA * 100)),
      serieUnidade: "% a.a.",
      referencia: P.realMin * 100,
      laterais: [
        { label: "Meta", value: `≥ ${fmtPct(P.realMin, 2)}` },
        { label: "IPCA 12m", value: fmtPct(p.ipca12m, 2) },
      ],
      detalhe: `Rentabilidade líquida ${fmtPct(r12.rentabLiq, 2)} sobre o capital médio; IPCA 12m da premissa (SAP)`,
    });
  }
  {
    const cmp = r12.cmp!;
    const d = r12.pctBruto - r12.bmk;
    const state = estadoBenchmark(d);
    const dm = reaisKpi(cmp.excesso);
    add("excesso", {
      valor: cmp.excesso,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      dataRef: janela,
      metaTexto: "≥ R$ 0",
      desvioRotulo: "Desvio",
      desvioTexto: comSinal(d, PP).texto,
      state,
      statusTexto: SITUACAO_TEXTO[situacaoBenchmark(r12.pctBruto, r12.bmk)],
      tendencia: tend(cmp.excesso - (rAnt.cmp?.excesso ?? 0), "brl", "up"),
      serie: serie(evol.map((m, i) => (m.rendimentos - (mensal[i].cmp?.rendBenchmark ?? 0)) / 1e3)),
      serieUnidade: "R$ mil",
      referencia: 0,
      laterais: [
        { label: "Meta", value: "≥ R$ 0" },
        { label: "Em p.p. do CDI", value: comSinal(d, PP).texto, state },
      ],
      detalhe: `Realizado ${fmtCompact(cmp.rendimento)} × benchmark ${fmtCompact(cmp.rendBenchmark)}`,
      tabela: {
        valor: `${comSinal(d, PP).texto} do CDI`,
        ordem: d,
        detalhe: `${fmtCompact(cmp.excesso)} em 12 meses`,
        meta: `≥ 0,0 p.p. (em linha: ±${fmtDec(TOLERANCIA_BENCHMARK * 100, 1)} p.p.)`,
      },
    });
  }

  // --- 3. Liquidez e prazo ---
  {
    const r = regra(f, "liquidez");
    const state = ESTADO_SEMAFORO[r.status];
    add("liquidez", {
      valor: r.share,
      valorTexto: pct1(r.share),
      unidade: "",
      dataRef: naData,
      metaTexto: `≥ ${fmtPct(r.limite, 0)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(r.share - r.limite, PP).texto,
      state,
      statusTexto: SEMAFORO_TEXTO[r.status],
      tendencia: tend(r.share - regra(fAnt, "liquidez").share, PP, "up"),
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
      dataRef: naData,
      metaTexto: `≤ ${fmtInt(P.prazoMax)} dias`,
      desvioRotulo: "Folga",
      desvioTexto: v === null ? "—" : comSinal(Math.round(P.prazoMax - v), { escala: 1, casas: 0, sufixo: " dias" }).texto,
      state,
      statusTexto: v === null ? "Sem contratos com vencimento" : STATUS_TEXTO[state],
      tendencia:
        v !== null && fAnt.prazoMedio !== null ? tend(Math.round(v) - Math.round(fAnt.prazoMedio), { escala: 1, casas: 0, sufixo: " dias" }, "down") : undefined,
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
    const dm = reaisKpi(f.venc90);
    add("venc90", {
      valor: f.venc90,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      dataRef: naData,
      metaTexto: `≤ ${fmtPct(P.venc90Max, 0)} da carteira`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(P.venc90Max - share, PP).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tend(f.venc90 - fAnt.venc90, "brl", null),
      serie: serie(fotos.map((fo) => fo.venc90 / 1e6)),
      serieUnidade: "R$ mi",
      laterais: [
        { label: "% da carteira", value: pct1(share), state },
        { label: "Contratos", value: String(f.venc90n) },
      ],
      detalhe: `Vencimentos até ${fmtDate(addDays(db, 90))} · limite de ${fmtPct(P.venc90Max, 0)} da carteira`,
      tabela: {
        valor: `${pct1(share)} da carteira`,
        ordem: share,
        detalhe: `${fmtCompact(f.venc90)} · ${plural(f.venc90n, "contrato", "contratos")}`,
        meta: `≤ ${fmtPct(P.venc90Max, 0)} da carteira`,
      },
    });
  }
  {
    const v = f.duration;
    const state: ValueState = v === null ? "neutral" : estadoLimite(v, "max", P.durationMax, P.durationAlerta);
    add("duration", {
      valor: v,
      valorTexto: v === null ? "—" : fmtDec(v, 2),
      unidade: "anos",
      dataRef: naData,
      metaTexto: `≤ ${fmtDec(P.durationMax, 1)} anos`,
      desvioRotulo: "Folga",
      desvioTexto: v === null ? "—" : comSinal(P.durationMax - v, ANO).texto,
      state,
      statusTexto: v === null ? "Sem títulos prefixados ou IPCA" : STATUS_TEXTO[state],
      tendencia: v !== null && fAnt.duration !== null ? tend(v - fAnt.duration, ANO, "down") : undefined,
      serie: serie(fotos.map((fo) => fo.duration ?? 0)),
      serieUnidade: "anos",
      referencia: v === null ? undefined : P.durationMax,
      laterais: [
        { label: "Limite", value: `${fmtDec(P.durationMax, 1)} anos` },
        { label: "Folga", value: v === null ? "—" : comSinal(P.durationMax - v, ANO).texto, state },
      ],
      detalhe:
        (v === null
          ? "Nenhum título prefixado ou IPCA no escopo"
          : `${plural(f.titulos, "título", "títulos")} · ${fmtCompact(f.mercadoTitulos)} a mercado (ANBIMA)`) +
        ` · LFT fora: pós-fixada${f.mercadoLFT > 0 ? ` (${fmtCompact(f.mercadoLFT)})` : ""}`,
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
      dataRef: naData,
      metaTexto: `< ${fmtInt(P.hhiLimite)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(Math.round(P.hhiLimite - f.hhi), { escala: 1, casas: 0, sufixo: " pontos" }).texto,
      state,
      statusTexto: classe.rotulo,
      tendencia: tend(Math.round(f.hhi) - Math.round(fAnt.hhi), { escala: 1, casas: 0, sufixo: " pontos" }, "down"),
      serie: serie(fotos.map((fo) => fo.hhi)),
      serieUnidade: "pontos",
      referencia: P.hhiLimite,
      laterais: [
        { label: "Limite", value: fmtInt(P.hhiLimite) },
        { label: "Grupos", value: String(f.grupos.length) },
      ],
      detalhe: f.grupos[0]
        ? `Maior grupo: ${f.grupos[0].grupo} (${fmtPct(f.grupos[0].share, 1)} da carteira) · fundos fora (patrimônio segregado)`
        : "Fundos fora (patrimônio segregado)",
    });
  }
  {
    const g = f.maiorUtil;
    const state: ValueState = g ? ESTADO_SEMAFORO[g.status] : "neutral";
    add("limiteGrupo", {
      valor: g?.utilizacao ?? null,
      valorTexto: g ? `${fmtDec(g.utilizacao * 100, 0)}%` : "—",
      unidade: "do limite",
      dataRef: naData,
      metaTexto: "≤ 100% do limite",
      desvioRotulo: "Folga",
      desvioTexto: g ? comSinal(P.utilMax - g.utilizacao, PP).texto : "—",
      state,
      statusTexto: g ? SEMAFORO_TEXTO[g.status] : "Sem grupos com limite",
      tendencia: g && fAnt.maiorUtil ? tend(g.utilizacao - fAnt.maiorUtil.utilizacao, PP, "down") : undefined,
      serie: serie(fotos.map((fo) => (fo.maiorUtil?.utilizacao ?? 0) * 100)),
      serieUnidade: "% do limite",
      referencia: 100,
      laterais: g
        ? [
            { label: "Participação", value: pct1(g.share) },
            { label: `Limite ${g.rating}`, value: fmtPct(g.limite, 0) },
          ]
        : [],
      detalhe: g
        ? `${g.grupo} · ${plural(g.operacoes, "contrato", "contratos")} · rating ${g.rating} · fundos têm limite próprio (20%)`
        : undefined,
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
      valorTexto: pct1(r.share),
      unidade: "",
      dataRef: naData,
      metaTexto: `≤ ${fmtPct(r.limite, 0)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(r.limite - r.share, PP).texto,
      state,
      statusTexto: SEMAFORO_TEXTO[r.status],
      tendencia: tend(r.share - regra(fAnt, rid).share, PP, "down"),
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
      valorTexto: fmtPct(r12.carga, 2),
      unidade: "",
      dataRef: janela,
      metaTexto: `≤ ${fmtPct(P.cargaMax, 0)}`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(P.cargaMax - r12.carga, PP2).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tend(r12.carga - rAnt.carga, PP2, "down"),
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
    const dm = reaisKpi(taxas12);
    add("taxas", {
      valor: taxas12,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      dataRef: janela,
      metaTexto: `≤ ${fmtInt(P.taxasMax)} bps a.a.`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(P.taxasMax - bps12, { escala: 1, casas: 1, sufixo: " bps" }).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tend(bps12 - bpsAnt, { escala: 1, casas: 1, sufixo: " bps" }, "down"),
      serie: serie(bpsMes),
      serieUnidade: "bps a.a.",
      referencia: P.taxasMax,
      laterais: [
        { label: "Custo a.a.", value: `${fmtDec(bps12, 1)} bps`, state },
        { label: "Limite", value: `${fmtInt(P.taxasMax)} bps` },
      ],
      detalhe: `Fundos ${fmtCompact(fundos12)} (na cota) · custódia ${fmtCompact(r12.custodia)} · tarifas de time deposits ${fmtCompact(r12.tarifas)}`,
      tabela: {
        valor: `${fmtDec(bps12, 1)} bps a.a.`,
        ordem: bps12,
        detalhe: `${fmtCompact(taxas12)} em 12 meses`,
        meta: `≤ ${fmtInt(P.taxasMax)} bps a.a.`,
      },
    });
  }
  {
    const r = regra(f, "fundos");
    const state = ESTADO_SEMAFORO[r.status];
    const dm = reaisKpi(ccAno);
    add("comeCotas", {
      valor: ccAno,
      valorTexto: dm.valor,
      unidade: dm.unidade,
      dataRef: `desde ${fmtDate(addDays(previousYearEnd(db), 1))}`,
      metaTexto: `Fundos ≤ ${fmtPct(r.limite, 0)} da carteira`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(r.limite - r.share, PP).texto,
      state,
      statusTexto: r.status === "ok" ? "Fundos dentro do limite" : r.status === "atencao" ? "Fundos perto do limite" : "Fundos acima do limite",
      tendencia: tend(ccAno - ccAnoAnt, "brl", null),
      serie: serie(evol.map((m) => m.comeCotas / 1e3)),
      serieUnidade: "R$ mil",
      laterais: [
        { label: "12 meses", value: fmtCompact(cc12) },
        { label: "Fundos", value: pct1(r.share), state },
      ],
      detalhe: dataProx
        ? `Próximo: ${fmtDate(dataProx)} · estimado ${fmtCompact(irProx)} (projeção com o último dado disponível)`
        : "Sem come-cotas previsto para os fundos do escopo",
      tabela: {
        valor: `${pct1(r.share)} da carteira (fundos)`,
        ordem: r.share,
        detalhe: `come-cotas no ano ${fmtCompact(ccAno)}`,
        meta: `≤ ${fmtPct(r.limite, 0)} da carteira`,
      },
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
      dataRef: naData,
      metaTexto: `≥ ${fmtDec(P.carryMin * 100, 2)} p.p.`,
      desvioRotulo: "Folga",
      desvioTexto: comSinal(v - P.carryMin, PP2).texto,
      state,
      statusTexto: STATUS_TEXTO[state],
      tendencia: tend(v - dAnt.carry.carryBruto, PP2, "up"),
      serie: serie(dividas.map((d) => d.carry.carryBruto * 100)),
      serieUnidade: "p.p.",
      referencia: P.carryMin * 100,
      laterais: [
        { label: "Mínimo", value: `${fmtDec(P.carryMin * 100, 2)} p.p.` },
        { label: "Carrego a.a.", value: fmtCompact(carry.custoCarregamento), state: carry.custoCarregamento < 0 ? "critical" : "positive" },
      ],
      detalhe:
        `Aplicações em R$ ${fmtPct(carry.taxaBruta)} a.a. × dívida ${fmtPct(carry.custoDivida)} a.a.` +
        (carry.saldoCambial > 0 ? ` · exposição cambial fora do carry: ${fmtCompact(carry.saldoCambial)} (time deposits e fundo cambial)` : ""),
    });
  }
  {
    const rot = rotuloCovenant(covDl);
    const v = covDl.dataApuracao ? covDl.valor : null;
    const anterior = hist.length > 1 ? hist[hist.length - 2] : null;
    add("dlEbitda", {
      valor: v,
      valorTexto: v === null ? "—" : fmtDec(v, 2) + "x",
      unidade: "",
      dataRef: covDl.dataApuracao ? `apuração ${fmtQuarter(covDl.dataApuracao)}` : "—",
      metaTexto: `≤ ${fmtDec(covDl.cov.limite, 2)}x`,
      desvioRotulo: "Folga",
      desvioTexto: v === null ? "—" : comSinal(covDl.folga, X2).texto,
      state: rot.state,
      statusTexto: rot.texto,
      tendencia: v !== null && anterior !== null ? tendencia(v - anterior.valor, X2, "down", `vs ${fmtQuarter(anterior.data)}`) : undefined,
      serie: hist.map((h) => ({ x: fmtQuarter(h.data), y: h.valor })),
      serieUnidade: "x (trimestral)",
      referencia: covDl.cov.limite,
      laterais: [
        { label: "Limite", value: `${fmtDec(covDl.cov.limite, 2)}x` },
        { label: "Alerta", value: `${fmtDec(covDl.cov.alerta, 2)}x` },
      ],
      detalhe:
        covDl.dataApuracao && apuracaoDl
          ? `Covenant – apuração ${fmtQuarter(covDl.dataApuracao)} (${fmtDate(covDl.dataApuracao)}): DL ${fmtCompact(apuracaoDl.dividaLiquida)} ÷ EBITDA 12m ${fmtCompact(apuracaoDl.ebitdaLTM)}`
          : "Sem apuração até a data-base",
    });
  }
  {
    const v = dv.cobertura;
    const state: ValueState = v === null ? "neutral" : estadoLimite(v, "min", LIM_COBERTURA.limite, LIM_COBERTURA.alerta);
    const caixaNaData = dv.dataCaixa === db;
    add("cobertura", {
      valor: v,
      valorTexto: v === null ? "—" : fmtDec(v, 2) + "x",
      unidade: "",
      dataRef: naData,
      metaTexto: `≥ ${fmtDec(LIM_COBERTURA.limite, 2)}x`,
      desvioRotulo: "Folga",
      desvioTexto: v === null ? "—" : comSinal(v - LIM_COBERTURA.limite, X2).texto,
      state,
      statusTexto: v === null ? "Sem dívida circulante" : STATUS_TEXTO[state],
      tendencia: v !== null && dAnt.cobertura !== null ? tend(v - dAnt.cobertura, X2, "up") : undefined,
      serie: serie(dividas.map((d) => d.cobertura ?? 0)),
      serieUnidade: "x",
      referencia: LIM_COBERTURA.limite,
      laterais: [
        { label: "Mínimo", value: `${fmtDec(LIM_COBERTURA.limite, 2)}x` },
        { label: "Dívida circulante", value: fmtCompact(dv.dividaCirculante) },
      ],
      detalhe:
        `Caixa ${fmtCompact(dv.caixa)}${!caixaNaData && dv.dataCaixa ? ` (${fmtDate(dv.dataCaixa)})` : ""} + aplicações circulantes ${fmtCompact(dv.aplicCirculantes)}` +
        (endiv.reclassificado > 0 ? ` · dívida inclui ${fmtCompact(endiv.reclassificado)} reclassificados (CPC 26, item 74)` : ""),
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
    janela,
    vsMes,
    kpis,
    f,
    r12,
    endiv,
    ebitda,
    composicao,
    moedaEstrangeira,
    fundos12,
    covDl,
    apuracaoDl,
  };
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function secaoTitulo(id: SecaoKpi): string {
  const s = SECOES_KPI.find((x) => x.id === id)!;
  return s.numero ? `${s.numero}. ${s.titulo}` : s.titulo;
}

/** "R$ 88,5 mi", "94,0% do CDI", "1,11x" */
function valorComUnidade(k: KpiCalc): string {
  return k.unidade ? `${k.valorTexto} ${k.unidade}` : k.valorTexto;
}

const faixaDe = (s: ValueState): KpiPlacarItem["faixa"] => (s === "positive" ? "ok" : s === "critical" ? "atencao" : s === "negative" ? "fora" : null);

export function KpisAplicacoes() {
  const { premissas: p } = usePremissas();
  const { cadastro } = useBenchmarks();
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const [modo, setModo] = useState<KpiModo>("cartoes");

  const d = useMemo(() => montarPainel(p, escopo, cadastro), [p, escopo, cadastro]);
  const db = p.dataBase;
  const escopoLabel = ESCOPOS.find((e) => e.value === escopo)?.label ?? "";

  const porId = (id: KpiId) => d.kpis.find((k) => k.def.id === id)!;
  const pctBruto = porId("pctBruto");

  const itensPlacar: KpiPlacarItem[] = d.kpis.map((k, i) => {
    const fonte = FONTE_META[k.def.fonte];
    return {
      id: k.def.id,
      secao: k.def.secao,
      curto: k.def.curto,
      nome: k.def.nome,
      state: k.state,
      statusTexto: k.statusTexto,
      faixa: faixaDe(k.state),
      resumo: `${k.tabela?.valor ?? valorComUnidade(k)} · ${fonte.palavra} ${k.tabela?.meta ?? k.metaTexto} · ${fonte.texto}`,
      prioridade: ORDEM_ESTADO[k.state] * 100 + i,
    };
  });
  const cont = contarPlacar(itensPlacar);

  const linhas: KpiLinha[] = d.kpis.map((k) => ({
    id: k.def.id,
    nome: k.def.nome,
    secao: `${secaoTitulo(k.def.secao)} · ${k.def.periodicidade}${k.def.consolidado && escopo !== "todas" ? " · consolidado" : ""}`,
    formula: k.def.formula,
    valor: k.tabela?.valor ?? valorComUnidade(k),
    valorOrdem: k.tabela?.ordem ?? k.valor,
    valorDetalhe: k.tabela?.detalhe ?? k.dataRef,
    meta: k.tabela?.meta ?? k.metaTexto,
    metaDetalhe: FONTE_META[k.def.fonte].texto,
    folga: k.desvioTexto === "—" ? undefined : k.desvioTexto,
    state: k.state,
    statusTexto: k.statusTexto,
    statusOrdem: ORDEM_ESTADO[k.state],
    tendencia: k.tendencia,
    rota: k.def.rota,
    origem: k.def.origem,
  }));

  const irPara = (id: string) => {
    setModo("cartoes");
    requestAnimationFrame(() => document.getElementById(`kpi-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const exportar = () =>
    exportarExcel(
      `KPIs_Aplicacoes_${db}.xlsx`,
      [
        {
          nome: "KPIs",
          titulo: "Painel de KPIs – Aplicações financeiras (Carteira-Mestre)",
          subtitulo: `${escopoLabel} · janela de 12 meses ${d.janela}`,
          colunas: [
            { titulo: "Seção", largura: 22 },
            { titulo: "KPI", largura: 36 },
            { titulo: "Valor", largura: 22 },
            { titulo: "Valor no cartão", largura: 16 },
            { titulo: "Valor (número)", tipo: "decimal", largura: 16 },
            { titulo: "Meta / limite", largura: 28 },
            { titulo: "Origem da meta", largura: 24 },
            { titulo: "Folga / desvio", largura: 18 },
            { titulo: "Status", largura: 24 },
            { titulo: "Tendência", largura: 24 },
            { titulo: "Escopo", largura: 14 },
            { titulo: "Fonte", largura: 20 },
          ],
          linhas: d.kpis.map((k) => [
            secaoTitulo(k.def.secao),
            k.def.nome,
            k.tabela?.valor ?? valorComUnidade(k),
            valorComUnidade(k),
            k.valor,
            k.tabela?.meta ?? k.metaTexto,
            FONTE_META[k.def.fonte].texto,
            `${k.desvioRotulo} ${k.desvioTexto}`,
            STATUS_TEXTO[k.state] === k.statusTexto ? k.statusTexto : `${STATUS_TEXTO[k.state]} – ${k.statusTexto}`,
            k.tendencia?.texto ?? "",
            k.def.consolidado ? "Consolidado" : escopoLabel,
            k.def.origem,
          ]),
          notas: [
            "Valor na mesma grandeza da meta; \"Valor no cartão\" traz o valor exibido no cartão (R$ nos KPIs de taxas, come-cotas, vencimentos e excesso).",
            "Valor (número) na unidade-base do cartão: R$; percentuais, % do CDI, p.p. e utilização em fração (0,25 = 25%); prazos em dias; duration em anos; HHI em pontos; múltiplos em x; enquadramento em nº de regras.",
            "Folga / desvio: positivo = dentro da meta ou do limite (ou acima do benchmark); negativo = fora.",
            `Contagem: ${cont.ok} KPIs na meta, ${cont.atencao} em atenção e ${cont.fora} fora da meta. KPIs de aplicações × dívida são sempre consolidados.`,
            "Séries de 12 fins de mês com as premissas da data-base (histórico até a data-base); carry e cobertura de curto prazo com as premissas de cada data (iguais ao R06 daquela data-base); o próximo come-cotas é projeção com o último dado disponível.",
          ],
        },
        {
          nome: "Séries 12 meses",
          titulo: "Séries dos micrográficos – 12 fins de mês",
          subtitulo: `${escopoLabel} · DL/EBITDA em apurações trimestrais`,
          colunas: [
            { titulo: "KPI", largura: 36 },
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
            { titulo: "KPI", largura: 36 },
            { titulo: "Fórmula", largura: 70 },
            { titulo: "Unidade", largura: 14 },
            { titulo: "Meta / limite", largura: 50 },
            { titulo: "Origem da meta", largura: 24 },
            { titulo: "Tipo", largura: 9 },
            { titulo: "Regra de status", largura: 70 },
            { titulo: "Micrográfico", largura: 44 },
            { titulo: "Fonte", largura: 20 },
          ],
          linhas: DEFINICOES.map((x) => [
            x.nome,
            x.formula,
            x.unidade,
            x.meta,
            FONTE_META[x.fonte].texto,
            x.tipo === "max" ? "Máximo" : "Mínimo",
            x.regra,
            x.serie,
            x.origem,
          ]),
        },
      ],
      db,
    );

  const secao = (id: SecaoKpi, children: ReactNode) => {
    const s = SECOES_KPI.find((x) => x.id === id)!;
    const c = contarPlacar(itensPlacar.filter((k) => k.secao === id));
    const estado: ValueState = c.fora ? "negative" : c.atencao ? "critical" : "positive";
    return (
      <KpiSecao id={id} titulo={secaoTitulo(id)} periodo={s.periodo} contagem={{ ok: c.ok, total: c.comMeta, estado }}>
        {children}
      </KpiSecao>
    );
  };
  const cartoes = (ids: KpiId[]) => ids.map((id) => <CartaoKpi key={id} k={porId(id)} />);

  const caixaNaData = d.endiv.dataCaixa === db;
  const dlDif = d.apuracaoDl ? d.endiv.dividaLiquida - d.apuracaoDl.dividaLiquida : 0;

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi
            label={escopo === "todas" ? "Saldo consolidado" : "Saldo da empresa"}
            value={fmtCompact(d.f.saldo)}
            sub={`${plural(d.f.cs.length, "contrato", "contratos")} · ${escopo === "todas" ? "consolidado" : `empresa ${escopo}`}`}
          />
          <HeaderKpi
            label="% do CDI 12m"
            value={pctBruto.valorTexto}
            state={pctBruto.state}
            sub={`Benchmark ${pct1(d.r12.bmk)} · ${pctBruto.statusTexto.toLowerCase()}`}
          />
          <HeaderKpi
            label="KPIs na meta"
            value={`${cont.ok}/${cont.comMeta}`}
            state={cont.ok === cont.comMeta ? "positive" : cont.fora ? "negative" : "critical"}
            sub={`${cont.atencao} em atenção · ${cont.fora} fora da meta`}
          />
          <HeaderKpi label="KPIs fora da meta" value={String(cont.fora)} state={cont.fora ? "negative" : "positive"} sub={`de ${cont.comMeta} com meta ou limite`} />
        </>
      }
    >
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <FilterField label="Empresa">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
          </FilterField>
          <div className="sm:col-span-2 text-[13px] text-label sm:text-right leading-snug">
            Janela de 12 meses: {d.janela} · séries de 12 fins de mês com as premissas da data-base · aplicações × dívida sempre consolidado
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <KpiPlacar
          className="lg:col-span-2 xl:col-span-3"
          subtitulo={`${cont.comMeta} KPIs com meta ou limite · ${escopoLabel} · data-base ${fmtDate(db)}`}
          secoes={SECOES_KPI.map((s) => ({ id: s.id, titulo: secaoTitulo(s.id) }))}
          itens={itensPlacar}
          modo={modo}
          onModo={setModo}
          onIr={irPara}
          rodape="Metas e limites fictícios (ambiente de demonstração): política de investimentos, política financeira e metas do comitê; DL/EBITDA conforme escrituras e contratos. Séries com as premissas importadas do SAP; próximo come-cotas projetado com o último dado disponível."
        />
        <CartaoKpi k={porId("enquadramento")} />
      </div>

      {modo === "tabela" ? (
        <KpiTabela
          linhas={linhas}
          subtitulo={`Valor na data-base ou na janela de 12 meses, na mesma grandeza da meta · folga · status · tendência ${d.vsMes} · relatório de origem`}
        />
      ) : (
        <>
          {secao(
            "resultado",
            <>
              {cartoes(["saldo", "rendBruto", "rendLiquido"])}
              <KpiPainel
                titulo="Composição por tipo de contrato"
                subtitulo={`Saldo bruto em ${fmtDate(db)} · (nº de contratos)`}
                rota="/carteira-mestre"
                origem={ORIGEM.cm}
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
              </KpiPainel>
            </>,
          )}

          {secao("rentabilidade", cartoes(["pctBruto", "pctLiquido", "real", "excesso"]))}
          {secao("liquidez", cartoes(["liquidez", "prazo", "venc90", "duration"]))}
          {secao("risco", cartoes(["hhi", "limiteGrupo", "cambial", "credito"]))}

          {secao(
            "custos",
            <>
              {cartoes(["carga", "taxas", "comeCotas"])}
              <KpiPainel
                titulo="Do bruto ao líquido – 12 meses"
                subtitulo={`Rendimentos de ${d.janela} · R$`}
                rota="/r03-rentabilidade"
                origem={ORIGEM.r03}
                rodape={`Taxas de adm./performance dos fundos (${fmtCompact(d.fundos12)}) já descontadas na cota`}
              >
                <KpiPonte
                  base={d.r12.rend}
                  linhas={[
                    { rotulo: "Rendimento bruto", valor: d.r12.rend, cor: CHART_SEMANTIC.good, forte: true },
                    { rotulo: "(−) IR", valor: d.r12.ir, cor: CHART_SEMANTIC.bad },
                    { rotulo: "(−) IOF", valor: d.r12.iof, cor: CHART_SEMANTIC.bad },
                    { rotulo: "(−) Custódia e tarifas", valor: d.r12.taxas, cor: CHART_SEMANTIC.critical },
                    { rotulo: "Rendimento líquido", valor: d.r12.liq, cor: "#0070f2", forte: true },
                  ]}
                />
              </KpiPainel>
            </>,
          )}

          {secao(
            "divida",
            <>
              {cartoes(["carry", "dlEbitda", "cobertura"])}
              <KpiPainel
                titulo="Dívida líquida na data-base"
                subtitulo={`Consolidado · ${fmtDate(db)}${d.endiv.dataCaixa && !caixaNaData ? ` · caixa de ${fmtDate(d.endiv.dataCaixa)}` : ""} · R$`}
                rota="/r06-indicadores"
                origem={ORIGEM.r06}
                rodape={
                  d.apuracaoDl && d.covDl.dataApuracao
                    ? Math.abs(dlDif) >= 5e4
                      ? `Apuração ${fmtQuarter(d.covDl.dataApuracao)} (covenant DL/EBITDA): dívida líquida ${fmtCompact(d.apuracaoDl.dividaLiquida)}`
                      : `Igual à apuração ${fmtQuarter(d.covDl.dataApuracao)} (covenant DL/EBITDA) · EBITDA 12m ${fmtCompact(d.apuracaoDl.ebitdaLTM)}`
                    : undefined
                }
              >
                <KpiPonte
                  base={d.endiv.dividaBruta}
                  linhas={[
                    { rotulo: "Dívida bruta", valor: d.endiv.dividaBruta, cor: "#df1278", forte: true },
                    { rotulo: `(−) Caixa${d.endiv.dataCaixa && !caixaNaData ? ` (${fmtDate(d.endiv.dataCaixa)})` : ""}`, valor: d.endiv.caixa, cor: "#758ca4" },
                    { rotulo: "(−) Aplicações (valor contábil)", valor: d.endiv.aplicacoesContabil, cor: "#0070f2" },
                    { rotulo: "Dívida líquida", valor: d.endiv.dividaLiquida, cor: "#8b47d7", forte: true },
                  ]}
                />
              </KpiPainel>
            </>,
          )}
        </>
      )}
    </ReportPage>
  );
}

function CartaoKpi({ k }: { k: KpiCalc }) {
  return (
    <div id={`kpi-${k.def.id}`} className="flex min-w-0 scroll-mt-24" title={`${k.def.formula}\nMeta: ${k.def.meta}\n${k.def.regra}`}>
      <KpiCard
        className="flex-1"
        titulo={k.def.nome}
        subtitulo={k.def.resumo}
        valor={k.valorTexto}
        unidade={k.unidade || undefined}
        state={k.state}
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
