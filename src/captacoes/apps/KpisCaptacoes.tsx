import clsx from "clsx";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { contratosMestre } from "../../aplicacoes/lib/carteiraMestre";
import { LIMITES_POLITICA } from "../../aplicacoes/lib/indicadores";
import { CHART_SEMANTIC, HeaderKpi } from "../../shared/components/fiori/Kpi";
import {
  KpiCard,
  KpiPainel,
  KpiPlacar,
  KpiPonte,
  KpiSecao,
  KpiTabela,
  reaisKpi,
  type KpiIndicadorLateral,
  type KpiLinha,
  type KpiModo,
  type KpiPlacarItem,
  type KpiTendencia,
} from "../../shared/components/fiori/KpiCard";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { usePremissas } from "../../shared/context/MercadoContext";
import { DADOS_CORPORATIVOS } from "../../shared/data/corporativo";
import { ultimoDadoNaDataBase, type PremissasMercado } from "../../shared/data/mercado";
import { addDays, addMonths, endOfMonth, fmtDate, fmtMonthShort, fmtQuarter, lastMonthEnds, previousYearEnd, toDay } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtCompact, fmtDec, fmtInt, fmtPct, fmtX, plural } from "../../shared/lib/format";
import type { Semaforo } from "../../shared/lib/semaforo";
import { cdiAnual } from "../../shared/lib/taxas";
import { useCovenants } from "../context/useDivida";
import { relatorioCaptacao } from "../data/catalogo";
import { CONTRATOS, COR_INDEXADOR, COR_MODALIDADE, GRUPO_MODALIDADE, type IndexadorDivida } from "../data/contratos";
import { COVENANTS_DIVIDA, type CovenantId } from "../data/covenants";
import {
  apurarCovenants,
  icsdDoAno,
  indicadoresEm,
  reclassificadosEm,
  trimestresAte,
  type ApuracaoCovenant,
  type IndicadoresCorporativos,
} from "../lib/covenants";
import {
  cronograma,
  custoMedioPonderado,
  encargosDivida,
  movimentacaoDivida,
  posicoesDivida,
  prazoMedioCarteira,
  totalDivida,
  type PosicaoDivida,
} from "../lib/divida";

const rel = relatorioCaptacao("kpis");

// ---------------------------------------------------------------------------
// Definições dos KPIs
// ---------------------------------------------------------------------------

type SecaoKpi = "tamanho" | "custo" | "prazo" | "covenants" | "liquidez";

const SECOES_KPI: { id: SecaoKpi; numero: number; titulo: string; periodo: string }[] = [
  { id: "tamanho", numero: 1, titulo: "Tamanho da dívida", periodo: "Mensal · dívida líquida trimestral (apuração dos covenants) e na data-base" },
  { id: "custo", numero: 2, titulo: "Custo da dívida", periodo: "Mensal · 12 fins de mês" },
  { id: "prazo", numero: 3, titulo: "Prazo e perfil", periodo: "Mensal · 12 fins de mês" },
  { id: "covenants", numero: 4, titulo: "Covenants financeiros", periodo: "Trimestral / anual · consolidado" },
  { id: "liquidez", numero: 5, titulo: "Liquidez", periodo: "Mensal · 12 fins de mês" },
];

type Unidade = "brl" | "pctaa" | "pct" | "anos" | "x";
type TipoMeta = "meta" | "politica" | "covenant" | "info";

export interface DefinicaoKpi {
  id: string;
  secao: SecaoKpi;
  nome: string;
  /** nome curto para listas, para o placar e para o tile do Launchpad */
  sigla: string;
  subtitulo: string;
  formula: string;
  unidade: Unidade;
  tipo: TipoMeta;
  sentido?: "max" | "min";
  limite?: number;
  /** início da faixa de atenção */
  atencao?: number;
  /** meta relativa ao CDI da premissa: limite efetivo = CDI + limite */
  sobreCDI?: boolean;
  /** direção favorável à empresa (null = neutra) */
  favoravel: "up" | "down" | null;
  periodicidade: "Mensal" | "Trimestral" | "Anual";
  rota: string;
  origem: "C00" | "C01" | "C02" | "C03" | "C04";
  covenant?: CovenantId;
}

const ROTULO_TIPO: Record<TipoMeta, string> = {
  meta: "meta interna (fictícia)",
  politica: "política financeira",
  covenant: "covenant contratual",
  info: "informativo",
};

const NOME_ORIGEM: Record<DefinicaoKpi["origem"], string> = {
  C00: "Carteira",
  C01: "Movimentação",
  C02: "Vencimentos",
  C03: "Encargos",
  C04: "Covenants",
};

const SIGLA_COVENANT: Record<CovenantId, string> = {
  dlEbitda: "DL/EBITDA",
  icsd: "ICSD",
  capitalizacao: "Capitalização",
  ebitdaDespFin: "EBITDA/encargos",
  dlImoveisPl: "(DL + imóveis)/PL",
};

/** Cobertura de curto prazo: limite da política financeira interna (o mesmo do R06 e do painel de Aplicações) */
const LIM_COBERTURA = LIMITES_POLITICA.find((l) => l.id === "liquidez")!;

const DEFINICOES_BASE: DefinicaoKpi[] = [
  {
    id: "dividaBruta",
    secao: "tamanho",
    nome: "Dívida bruta",
    sigla: "Dívida bruta",
    subtitulo: "Custo amortizado (CPC 48)",
    formula: "Σ saldo pelo custo amortizado: principal atualizado + juros a pagar − custos de transação a apropriar",
    unidade: "brl",
    tipo: "info",
    favoravel: null,
    periodicidade: "Mensal",
    rota: "/c00-carteira",
    origem: "C00",
  },
  {
    id: "dividaLiquida",
    secao: "tamanho",
    nome: "Dívida líquida",
    sigla: "Dívida líquida",
    subtitulo: "Dívida − caixa − aplicações financeiras",
    formula:
      "Dívida bruta − caixa − aplicações financeiras consolidadas (Carteira-Mestre, valor contábil) no fim do trimestre (apuração dos covenants); na data-base, com o caixa do último balancete trimestral",
    unidade: "brl",
    tipo: "info",
    favoravel: "down",
    periodicidade: "Trimestral",
    rota: "/c04-covenants",
    origem: "C04",
  },
  {
    id: "captacoesAno",
    secao: "tamanho",
    nome: "Captações no ano",
    sigla: "Captações no ano",
    subtitulo: "Valor captado no exercício",
    formula: "Σ valor captado dos contratos novos desde 31/12 do exercício anterior (movimentação C01)",
    unidade: "brl",
    tipo: "info",
    favoravel: null,
    periodicidade: "Mensal",
    rota: "/c01-movimentacao",
    origem: "C01",
  },
  {
    id: "custoMedio",
    secao: "custo",
    nome: "Custo médio ponderado",
    sigla: "Custo médio",
    subtitulo: "Juros + correção, ponderado pelo saldo × CDI",
    formula: "Σ (taxa efetiva a.a. × saldo contábil) ÷ Σ saldo contábil; meta: até o CDI da premissa + 1,5 p.p.",
    unidade: "pctaa",
    tipo: "meta",
    sentido: "max",
    limite: 0.015,
    atencao: 0.01,
    sobreCDI: true,
    favoravel: "down",
    periodicidade: "Mensal",
    rota: "/c03-encargos",
    origem: "C03",
  },
  {
    id: "encargosLTM",
    secao: "custo",
    nome: "Encargos (12 meses)",
    sigla: "Encargos 12 meses",
    subtitulo: "Inclui juros capitalizados (CPC 20)",
    formula: "Juros + atualização monetária + apropriação de custos dos últimos 12 meses, inclusive os capitalizados no ativo qualificável (CPC 20)",
    unidade: "brl",
    tipo: "info",
    favoravel: null,
    periodicidade: "Mensal",
    rota: "/c03-encargos",
    origem: "C03",
  },
  {
    id: "cetMedio",
    secao: "custo",
    nome: "Custo efetivo (CET) médio",
    sigla: "CET médio",
    subtitulo: "Com custos de transação, ponderado pelo saldo",
    formula: "Σ (CET × saldo contábil) ÷ Σ saldo contábil; CET = TIR da captação líquida dos custos × pagamentos projetados",
    unidade: "pctaa",
    tipo: "info",
    favoravel: "down",
    periodicidade: "Mensal",
    rota: "/c00-carteira",
    origem: "C00",
  },
  {
    id: "exposicaoCDI",
    secao: "custo",
    nome: "Exposição ao CDI",
    sigla: "Exposição ao CDI",
    subtitulo: "Mix por indexador",
    formula: "Saldo contábil indexado ao CDI (taxa pós-fixada) ÷ dívida bruta; mix por indexador: CDI, IPCA, TJLP/TLP e prefixado",
    unidade: "pct",
    tipo: "meta",
    sentido: "max",
    limite: 0.6,
    atencao: 0.5,
    favoravel: "down",
    periodicidade: "Mensal",
    rota: "/c03-encargos",
    origem: "C03",
  },
  {
    id: "prazoMedio",
    secao: "prazo",
    nome: "Prazo médio remanescente",
    sigla: "Prazo médio",
    subtitulo: "Amortizações do principal",
    formula: "Σ (prazo até cada amortização × % do principal) ÷ Σ %, ponderado pelo principal atualizado de cada contrato",
    unidade: "anos",
    tipo: "meta",
    sentido: "min",
    limite: 3,
    atencao: 3.25,
    favoravel: "up",
    periodicidade: "Mensal",
    rota: "/c02-cronograma",
    origem: "C02",
  },
  {
    id: "curtoPrazo",
    secao: "prazo",
    nome: "Parcela de curto prazo",
    sigla: "% curto prazo",
    subtitulo: "Passivo circulante ÷ dívida bruta",
    formula: "Passivo circulante (principal até 12 meses + juros − custos; inclui a reclassificação do CPC 26, item 74) ÷ dívida bruta",
    unidade: "pct",
    tipo: "meta",
    sentido: "max",
    limite: 0.25,
    atencao: 0.2,
    favoravel: "down",
    periodicidade: "Mensal",
    rota: "/c02-cronograma",
    origem: "C02",
  },
  {
    id: "vencimentos12m",
    secao: "prazo",
    nome: "Vencimentos em 12 meses",
    sigla: "Vencimentos 12 meses",
    subtitulo: "Principal a pagar · fluxo projetado",
    formula: "Principal a pagar nos próximos 12 meses pelo cronograma projetado com o último dado disponível",
    unidade: "brl",
    tipo: "info",
    favoravel: null,
    periodicidade: "Mensal",
    rota: "/c02-cronograma",
    origem: "C02",
  },
  {
    id: "concentracao",
    secao: "prazo",
    nome: "Concentração por credor",
    sigla: "Maior credor",
    subtitulo: "Maior credor ou modalidade e HHI",
    formula:
      "Saldo da maior fonte ÷ dívida bruta; fonte = credor bilateral (BNDES, bancos) ou modalidade de mercado (debêntures, CRA, CRI – investidores pulverizados). HHI = Σ participação² × 10.000",
    unidade: "pct",
    tipo: "meta",
    sentido: "max",
    limite: 0.6,
    atencao: 0.5,
    favoravel: "down",
    periodicidade: "Mensal",
    rota: "/c00-carteira",
    origem: "C00",
  },
];

const DEFINICOES_COVENANTS: DefinicaoKpi[] = COVENANTS_DIVIDA.map((cov) => ({
  id: `cov-${cov.id}`,
  secao: "covenants",
  nome: cov.id === "icsd" ? "ICSD – serviço da dívida" : cov.indicador,
  sigla: SIGLA_COVENANT[cov.id],
  subtitulo: `Covenant ${cov.periodicidade.toLowerCase()} · ${cov.contratos.join(", ")}`,
  formula: cov.formula,
  unidade: cov.formato === "pct" ? "pct" : "x",
  tipo: "covenant",
  sentido: cov.tipo,
  limite: cov.limite,
  atencao: cov.alerta,
  favoravel: cov.tipo === "max" ? "down" : "up",
  periodicidade: cov.periodicidade,
  rota: "/c04-covenants",
  origem: "C04",
  covenant: cov.id,
}));

const DEFINICOES_LIQUIDEZ: DefinicaoKpi[] = [
  {
    id: "coberturaCP",
    secao: "liquidez",
    nome: "Cobertura de curto prazo",
    sigla: "Cobertura CP",
    subtitulo: "(Caixa + aplicações circulantes) ÷ dívida circulante",
    formula:
      "(Caixa do último balancete + aplicações circulantes pelo valor contábil – Carteira-Mestre de Aplicações) ÷ dívida circulante pelo custo amortizado (inclui a reclassificação do CPC 26, item 74) – mesma fórmula do R06 e do painel de Aplicações",
    unidade: "x",
    tipo: "politica",
    sentido: "min",
    limite: LIM_COBERTURA.limite,
    atencao: LIM_COBERTURA.alerta,
    favoravel: "up",
    periodicidade: "Mensal",
    rota: "/c02-cronograma",
    origem: "C02",
  },
  {
    id: "servicoLiquidez",
    secao: "liquidez",
    nome: "Serviço da dívida ÷ liquidez",
    sigla: "Serviço/liquidez",
    subtitulo: "Próximos 12 meses ÷ caixa + aplicações",
    formula: "Principal + juros a pagar nos próximos 12 meses (projeção) ÷ (caixa do último fechamento trimestral + aplicações financeiras)",
    unidade: "pct",
    tipo: "meta",
    sentido: "max",
    limite: 0.5,
    atencao: 0.4,
    favoravel: "down",
    periodicidade: "Mensal",
    rota: "/c02-cronograma",
    origem: "C02",
  },
];

/** Tabela de definições dos KPIs (ordem de exibição) */
export const DEFINICOES_KPI: DefinicaoKpi[] = [...DEFINICOES_BASE, ...DEFINICOES_COVENANTS, ...DEFINICOES_LIQUIDEZ];

// ---------------------------------------------------------------------------
// Helpers de formatação
// ---------------------------------------------------------------------------

function sinal(v: number, arredondado: number): string {
  return arredondado === 0 ? "" : v > 0 ? "+" : "−";
}

/** Valor principal do cartão: número + unidade (R$ no mesmo formato do painel de Aplicações: "R$ 161,7" "mi") */
function partesValor(u: Unidade, v: number): { valor: string; unidade?: string } {
  switch (u) {
    case "brl":
      return reaisKpi(v);
    case "pctaa":
      return { valor: fmtPct(v, 2), unidade: "a.a." };
    case "pct":
      return { valor: fmtPct(v, 1) };
    case "anos":
      return { valor: fmtDec(v, 2), unidade: "anos" };
    case "x":
      return { valor: fmtX(v) };
  }
}

function fmtValor(u: Unidade, v: number): string {
  const { valor, unidade } = partesValor(u, v);
  return unidade ? `${valor} ${unidade}` : valor;
}

/** Variação com sinal na unidade do KPI (p.p. para percentuais) */
function fmtDelta(u: Unidade, d: number): string {
  const a = Math.abs(d);
  switch (u) {
    case "brl": {
      const r = Math.round(a / 1e5) / 10;
      return `${sinal(d, r)}R$ ${fmtDec(a / 1e6, 1)} mi`;
    }
    case "pctaa": {
      const r = Math.round(a * 1e4) / 1e4;
      return `${sinal(d, r)}${fmtDec(a * 100, 2)} p.p.`;
    }
    case "pct": {
      const r = Math.round(a * 1e3) / 1e3;
      return `${sinal(d, r)}${fmtDec(a * 100, 1)} p.p.`;
    }
    case "anos": {
      const r = Math.round(a * 100) / 100;
      return `${sinal(d, r)}${fmtDec(a, 2)} ${r === 1 ? "ano" : "anos"}`;
    }
    case "x": {
      const r = Math.round(a * 100) / 100;
      return `${sinal(d, r)}${fmtX(a)}`;
    }
  }
}

/** A variação some no arredondamento de exibição? */
function deltaNulo(u: Unidade, d: number): boolean {
  const a = Math.abs(d);
  switch (u) {
    case "brl":
      return a < 0.05e6;
    case "pctaa":
      return a < 0.00005;
    case "pct":
      return a < 0.0005;
    case "anos":
    case "x":
      return a < 0.005;
  }
}

function fmtLimite(def: DefinicaoKpi, limite: number): string {
  return `${def.sentido === "max" ? "≤" : "≥"} ${fmtValor(def.unidade, limite)}`;
}

function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

function somar<T>(xs: T[], f: (x: T) => number): number {
  return xs.reduce((s, x) => s + f(x), 0);
}

function ponderar(pos: PosicaoDivida[], f: (x: PosicaoDivida) => number): number {
  const saldo = totalDivida(pos);
  return saldo > 0 ? pos.reduce((s, x) => s + f(x) * x.saldoContabil, 0) / saldo : 0;
}

/** HHI (0–10.000) e faixas usuais (mesmas do R07 de Aplicações) */
function indiceHHI(shares: number[]): number {
  return shares.reduce((s, x) => s + (x * 100) ** 2, 0);
}

function classeHHI(v: number): string {
  return v < 1500 ? "baixa concentração" : v <= 2500 ? "concentração moderada" : "alta concentração";
}

/** Primeiro fim de trimestre e primeiro 31/12 depois da data (próximas apurações dos covenants) */
function proximasApuracoes(data: string): { trimestral: string; anual: string } {
  const y = Number(data.slice(0, 4));
  const m = Number(data.slice(5, 7));
  let qm = Math.ceil(m / 3) * 3;
  let qy = y;
  let tri = endOfMonth(qy, qm);
  if (tri <= data) {
    qm += 3;
    if (qm > 12) {
      qm -= 12;
      qy += 1;
    }
    tri = endOfMonth(qy, qm);
  }
  const anual = `${y}-12-31` > data ? `${y}-12-31` : `${y + 1}-12-31`;
  return { trimestral: tri, anual };
}

// ---------------------------------------------------------------------------
// Foto mensal (posições da dívida, fluxos e liquidez num fim de mês)
// ---------------------------------------------------------------------------

interface Fatia {
  rotulo: string;
  saldo: number;
  share: number;
  cor: string;
}

interface FotoMensal {
  data: string;
  cdi: number;
  contratos: number;
  empresas: number;
  dividaBruta: number;
  circulante: number;
  naoCirculante: number;
  /** circulante pelo cronograma contratual (sem a reclassificação do CPC 26, item 74) */
  circulanteContratual: number;
  reclassificados: string[];
  custoMedio: number;
  cetMedio: number;
  prazoMedio: number;
  principal12m: number;
  juros12m: number;
  encargosLTM: number;
  capitalizadosLTM: number;
  captacoesAno: number;
  custosCaptacoesAno: number;
  novasNoAno: { id: string; data: string }[];
  /** captações acumuladas no mesmo período do exercício anterior */
  captacoesAnoAnterior: number;
  fontes: Fatia[];
  hhi: number;
  mix: Fatia[];
  aplicacoes: number;
  /** aplicações classificadas no ativo circulante (valor contábil) – base da cobertura de curto prazo */
  aplicacoesCirculantes: number;
  caixa: number | null;
  dataCaixa: string | null;
}

const MIX_INDEXADOR: { rotulo: string; ix: IndexadorDivida[]; cor: string }[] = [
  { rotulo: "CDI", ix: ["CDI"], cor: COR_INDEXADOR.CDI },
  { rotulo: "IPCA", ix: ["IPCA"], cor: COR_INDEXADOR.IPCA },
  { rotulo: "TJLP/TLP", ix: ["TJLP", "TLP"], cor: COR_INDEXADOR.TJLP },
  { rotulo: "Pré", ix: ["Pré"], cor: COR_INDEXADOR["Pré"] },
];

/**
 * Posição num fim de mês com as premissas da data-base (séries históricas até ela, projeção com o último dado
 * disponível depois dela) – a mesma base do C00/C02/C03, com a reclassificação do CPC 26 vigente em cada data.
 */
function fotoMensal(data: string, p: PremissasMercado): FotoMensal {
  const reclass = reclassificadosEm(data);
  const pos = posicoesDivida(CONTRATOS, data, p, reclass);
  const dividaBruta = totalDivida(pos);
  const circulante = somar(pos, (x) => x.circulante);
  const circulanteContratual = reclass.size ? somar(posicoesDivida(CONTRATOS, data, p), (x) => x.circulante) : circulante;

  const limite12m = addDays(data, 365);
  let principal12m = 0;
  let juros12m = 0;
  for (const l of cronograma(CONTRATOS, data, p)) {
    for (const e of l.eventos) {
      if (e.data > limite12m) continue;
      principal12m += e.principal;
      juros12m += e.juros;
    }
  }

  const enc = encargosDivida(CONTRATOS, addMonths(data, -12), data, p);
  const mov = movimentacaoDivida(CONTRATOS, previousYearEnd(data), data, p);
  const mesmoMesAnterior = addMonths(data, -12);
  const movAnterior = movimentacaoDivida(CONTRATOS, previousYearEnd(mesmoMesAnterior), mesmoMesAnterior, p);

  // Fontes: credor bilateral (BNDES, bancos) ou modalidade de mercado (investidores pulverizados)
  const porFonte = new Map<string, { saldo: number; cor: string }>();
  for (const x of pos) {
    const grupo = GRUPO_MODALIDADE[x.c.modalidade];
    const rotulo = grupo === "CCB" ? x.c.credor : grupo;
    const f = porFonte.get(rotulo) ?? { saldo: 0, cor: COR_MODALIDADE[grupo] ?? "#758ca4" };
    f.saldo += x.saldoContabil;
    porFonte.set(rotulo, f);
  }
  const fontes: Fatia[] = [...porFonte.entries()]
    .map(([rotulo, f]) => ({ rotulo, saldo: f.saldo, share: dividaBruta > 0 ? f.saldo / dividaBruta : 0, cor: f.cor }))
    .sort((a, b) => b.saldo - a.saldo);

  const mix: Fatia[] = MIX_INDEXADOR.map((m) => {
    const saldo = somar(
      pos.filter((x) => m.ix.includes(x.c.indexador)),
      (x) => x.saldoContabil,
    );
    return { rotulo: m.rotulo, saldo, share: dividaBruta > 0 ? saldo / dividaBruta : 0, cor: m.cor };
  });

  // Liquidez: aplicações consolidadas (Carteira-Mestre) e caixa do último fechamento trimestral
  const aplic = contratosMestre(data, p);
  const corp = DADOS_CORPORATIVOS.filter((x) => x.data <= data).pop() ?? null;

  return {
    data,
    cdi: cdiAnual(toDay(data), p),
    contratos: pos.length,
    empresas: new Set(pos.map((x) => x.c.empresa)).size,
    dividaBruta,
    circulante,
    naoCirculante: dividaBruta - circulante,
    circulanteContratual,
    reclassificados: [...reclass].sort(),
    custoMedio: custoMedioPonderado(pos),
    cetMedio: ponderar(pos, (x) => x.cet),
    prazoMedio: prazoMedioCarteira(pos),
    principal12m,
    juros12m,
    encargosLTM: somar(enc, (e) => e.total),
    capitalizadosLTM: somar(enc, (e) => e.capitalizados),
    captacoesAno: mov.total.captacoes,
    custosCaptacoesAno: -mov.total.custosTransacao,
    novasNoAno: mov.linhas
      .filter((l) => l.captacoes > 0)
      .map((l) => ({ id: l.c.id, data: l.c.dataCaptacao }))
      .sort((x, y) => x.data.localeCompare(y.data)),
    captacoesAnoAnterior: movAnterior.total.captacoes,
    fontes,
    hhi: indiceHHI(fontes.map((f) => f.share)),
    mix,
    aplicacoes: somar(aplic, (x) => x.valorContabil),
    aplicacoesCirculantes: somar(
      aplic.filter((x) => x.circulante),
      (x) => x.valorContabil,
    ),
    caixa: corp?.caixa ?? null,
    dataCaixa: corp?.data ?? null,
  };
}

/** Cobertura de curto prazo: (caixa + aplicações circulantes) ÷ dívida circulante */
function coberturaDe(f: FotoMensal): number | null {
  return f.circulante > 0 ? ((f.caixa ?? 0) + f.aplicacoesCirculantes) / f.circulante : null;
}

/** Dívida líquida na data (caixa do último balancete trimestral) – a mesma do R06 e do painel de Aplicações */
function dividaLiquidaNaData(f: FotoMensal): number {
  return f.dividaBruta - (f.caixa ?? 0) - f.aplicacoes;
}

// ---------------------------------------------------------------------------
// Avaliação dos KPIs (usada pela tela e pelo tile do Launchpad)
// ---------------------------------------------------------------------------

export interface ResultadoKpi {
  def: DefinicaoKpi;
  valor: number;
  /** data de referência do valor (fim do mês, do trimestre ou da última apuração) */
  referencia: string;
  limite?: number;
  atencao?: number;
  /** null = informativo (sem meta) */
  status: Semaforo | null;
  estado: ValueState;
  statusTexto: string;
  /** texto curto para o rodapé do tile */
  statusCurto: string;
  /** valor − meta/limite */
  desvio?: number;
  /** distância até a meta/limite: positiva = dentro, negativa = fora */
  folga?: number;
  anterior?: { valor: number; rotulo: string };
  laterais?: { label: string; valor: string; state?: ValueState }[];
  detalhe?: string;
  apuracao?: ApuracaoCovenant;
  /** 0 = mais crítico */
  prioridade: number;
}

interface ContextoKpi {
  atual: FotoMensal;
  anterior: FotoMensal | null;
  apuracoes: ApuracaoCovenant[];
  trimestres: IndicadoresCorporativos[];
  ultimoDado: string;
}

function avaliarLimite(sentido: "max" | "min", v: number, limite: number, atencao: number): Semaforo {
  if (sentido === "max") return v > limite ? "excedido" : v >= atencao ? "atencao" : "ok";
  return v < limite ? "excedido" : v <= atencao ? "atencao" : "ok";
}

const DEF = new Map(DEFINICOES_KPI.map((d) => [d.id, d]));

function montarKpis(ctx: ContextoKpi): ResultadoKpi[] {
  const { atual: a, anterior: b, apuracoes, trimestres, ultimoDado } = ctx;
  const out: ResultadoKpi[] = [];
  const rotuloMes = b ? fmtMonthShort(b.data) : "";

  const add = (
    id: string,
    valor: number,
    referencia: string,
    anterior: { valor: number; rotulo: string } | null,
    extra: Pick<ResultadoKpi, "laterais" | "detalhe"> & { limite?: number; atencao?: number; subtitulo?: string } = {},
  ) => {
    const base = DEF.get(id)!;
    const def = extra.subtitulo ? { ...base, subtitulo: extra.subtitulo } : base;
    const limite = extra.limite ?? def.limite;
    const atencao = extra.atencao ?? def.atencao;
    if (def.tipo === "info" || limite === undefined || atencao === undefined || !def.sentido) {
      out.push({
        def,
        valor,
        referencia,
        status: null,
        estado: "neutral",
        statusTexto: "Informativo",
        statusCurto: "informativo",
        anterior: anterior ?? undefined,
        laterais: extra.laterais,
        detalhe: extra.detalhe,
        prioridade: 9,
      });
      return;
    }
    const status = avaliarLimite(def.sentido, valor, limite, atencao);
    out.push({
      def,
      valor,
      referencia,
      limite,
      atencao,
      status,
      estado: status === "ok" ? "positive" : status === "atencao" ? "critical" : "negative",
      statusTexto: status === "ok" ? "Na meta" : status === "atencao" ? "Em atenção" : "Fora da meta",
      statusCurto: status === "ok" ? "na meta" : status === "atencao" ? "em atenção" : "fora da meta",
      desvio: valor - limite,
      folga: def.sentido === "max" ? limite - valor : valor - limite,
      anterior: anterior ?? undefined,
      laterais: extra.laterais,
      detalhe: extra.detalhe,
      prioridade: status === "excedido" ? 1 : status === "atencao" ? 3 : 8,
    });
  };

  // 1. Tamanho
  add("dividaBruta", a.dividaBruta, a.data, b && { valor: b.dividaBruta, rotulo: rotuloMes }, {
    laterais: [
      { label: "Circulante", valor: fmtCompact(a.circulante), state: a.reclassificados.length ? "negative" : undefined },
      { label: "Não circulante", valor: fmtCompact(a.naoCirculante) },
    ],
    detalhe:
      `${plural(a.contratos, "contrato ativo", "contratos ativos")} · ${plural(a.empresas, "empresa", "empresas")}` +
      (a.reclassificados.length ? ` · ${listar(a.reclassificados)} no circulante por covenant (CPC 26, item 74)` : ""),
  });

  const tri = trimestres[trimestres.length - 1];
  const triAnt = trimestres[trimestres.length - 2];
  if (tri) {
    const naData = dividaLiquidaNaData(a);
    const mesmaData = tri.data === a.data;
    add("dividaLiquida", tri.dividaLiquida, tri.data, triAnt ? { valor: triAnt.dividaLiquida, rotulo: fmtQuarter(triAnt.data) } : null, {
      subtitulo: `Dívida − caixa − aplicações · apuração ${fmtQuarter(tri.data)}`,
      laterais: [
        { label: "Caixa + aplicações", valor: fmtCompact(tri.caixa + tri.aplicacoes) },
        { label: "DL/EBITDA", valor: fmtX(tri.dlEbitda) },
      ],
      detalhe: mesmaData
        ? `Apuração de ${fmtDate(tri.data)} (base dos covenants) = dívida líquida na data-base · aplicações da Carteira-Mestre de Aplicações`
        : `Apuração ${fmtQuarter(tri.data)} (${fmtDate(tri.data)}, base dos covenants) · na data-base ${fmtDate(a.data)}${a.dataCaixa ? `, caixa de ${fmtDate(a.dataCaixa)}` : ""}: ${fmtCompact(naData)}`,
    });
  }

  const mesAnoAnterior = addMonths(a.data, -12);
  add("captacoesAno", a.captacoesAno, a.data, { valor: a.captacoesAnoAnterior, rotulo: `${fmtMonthShort(mesAnoAnterior)} (acum.)` }, {
    laterais: [
      { label: "Custos de transação", valor: fmtCompact(a.custosCaptacoesAno) },
      { label: "Novos contratos", valor: fmtInt(a.novasNoAno.length) },
    ],
    detalhe: a.novasNoAno.length
      ? `Exercício de ${a.data.slice(0, 4)}: ${a.novasNoAno.map((n) => `${n.id} (${fmtMonthShort(n.data)})`).join(", ")}`
      : `Nenhuma captação no exercício de ${a.data.slice(0, 4)}`,
  });

  // 2. Custo
  const spread = a.custoMedio - a.cdi;
  add("custoMedio", a.custoMedio, a.data, b && { valor: b.custoMedio, rotulo: rotuloMes }, {
    limite: a.cdi + DEF.get("custoMedio")!.limite!,
    atencao: a.cdi + DEF.get("custoMedio")!.atencao!,
    detalhe: `CDI ${fmtPct(a.cdi)} a.a. (premissa SAP) · spread ${fmtDelta("pctaa", spread)} sobre o CDI · ${fmtDec((a.custoMedio / a.cdi) * 100, 1)}% do CDI`,
  });

  add("encargosLTM", a.encargosLTM, a.data, b && { valor: b.encargosLTM, rotulo: rotuloMes }, {
    laterais: [
      { label: "Capitalizados (CPC 20)", valor: fmtCompact(a.capitalizadosLTM) },
      { label: "Despesa financeira", valor: fmtCompact(a.encargosLTM - a.capitalizadosLTM) },
    ],
    detalhe: `${fmtMonthShort(addDays(addMonths(a.data, -12), 1))} a ${fmtMonthShort(a.data)} · ${fmtPct(a.encargosLTM > 0 ? a.capitalizadosLTM / a.encargosLTM : 0, 1)} capitalizado no custo do ativo qualificável`,
  });

  add("cetMedio", a.cetMedio, a.data, b && { valor: b.cetMedio, rotulo: rotuloMes }, {
    laterais: [
      { label: "Custo médio", valor: `${fmtPct(a.custoMedio)} a.a.` },
      { label: "Custos de transação", valor: fmtDelta("pctaa", a.cetMedio - a.custoMedio) },
    ],
    detalhe: "TIR dos fluxos de cada contrato: captação líquida dos custos × pagamentos projetados com o último dado disponível",
  });

  const cdi = a.mix.find((m) => m.rotulo === "CDI");
  add("exposicaoCDI", cdi?.share ?? 0, a.data, b ? { valor: b.mix.find((m) => m.rotulo === "CDI")?.share ?? 0, rotulo: rotuloMes } : null, {
    detalhe: a.mix.map((m) => `${m.rotulo} ${fmtPct(m.share, 1)}`).join(" · "),
  });

  // 3. Prazo e perfil
  add("prazoMedio", a.prazoMedio, a.data, b && { valor: b.prazoMedio, rotulo: rotuloMes }, {
    detalhe: "Prazo até cada amortização de principal, ponderado pelo principal atualizado (C02)",
  });

  const pctCP = a.dividaBruta > 0 ? a.circulante / a.dividaBruta : 0;
  add("curtoPrazo", pctCP, a.data, b && { valor: b.dividaBruta > 0 ? b.circulante / b.dividaBruta : 0, rotulo: rotuloMes }, {
    detalhe: a.reclassificados.length
      ? `Inclui ${fmtCompact(a.circulante - a.circulanteContratual)} de ${listar(a.reclassificados)} reclassificados do não circulante (CPC 26, item 74); pelo cronograma contratual: ${fmtPct(a.dividaBruta > 0 ? a.circulanteContratual / a.dividaBruta : 0, 1)}`
      : `Circulante ${fmtCompact(a.circulante)} de ${fmtCompact(a.dividaBruta)}: principal até 12 meses + juros a pagar − custos a apropriar`,
  });

  add("vencimentos12m", a.principal12m, a.data, b && { valor: b.principal12m, rotulo: rotuloMes }, {
    laterais: [
      { label: "Juros (12 meses)", valor: fmtCompact(a.juros12m) },
      { label: "Serviço total", valor: fmtCompact(a.principal12m + a.juros12m) },
    ],
    detalhe: `Pagamentos até ${fmtDate(addDays(a.data, 365))} projetados com o último dado disponível (${fmtDate(ultimoDado)})`,
  });

  const maior = a.fontes[0];
  if (maior) {
    add("concentracao", maior.share, a.data, b?.fontes[0] ? { valor: b.fontes[0].share, rotulo: rotuloMes } : null, {
      detalhe: `Maior fonte: ${maior.rotulo} · HHI ${fmtInt(a.hhi)} (${classeHHI(a.hhi)})`,
    });
  }

  // 4. Covenants (consolidados, iguais ao C04)
  for (const ap of apuracoes) {
    const def = DEF.get(`cov-${ap.cov.id}`)!;
    if (!ap.dataApuracao) continue;
    const h = ap.historico;
    const ant = h.length > 1 ? h[h.length - 2] : null;
    const anual = ap.cov.periodicidade === "Anual";
    const ind = ap.cov.id === "icsd" ? null : indicadoresEm(ap.dataApuracao);
    let base = "";
    switch (ap.cov.id) {
      case "dlEbitda":
        base = `DL ${fmtCompact(ind!.dividaLiquida)} ÷ EBITDA 12 meses ${fmtCompact(ind!.ebitdaLTM)}`;
        break;
      case "icsd": {
        const ic = icsdDoAno(Number(ap.dataApuracao.slice(0, 4)));
        base = `Geração de caixa ${fmtCompact(ic.geracaoCaixa)} ÷ serviço da dívida ${fmtCompact(ic.servicoDivida)} (${ic.ano})`;
        break;
      }
      case "capitalizacao":
        base = `PL ${fmtCompact(ind!.patrimonioLiquido)} ÷ ativo total ${fmtCompact(ind!.ativoTotal)}`;
        break;
      case "ebitdaDespFin":
        base = `EBITDA ${fmtCompact(ind!.ebitdaLTM)} ÷ encargos 12 meses ${fmtCompact(ind!.encargosLTM)} (inclui capitalizados)`;
        break;
      case "dlImoveisPl":
        base = `(DL ${fmtCompact(ind!.dividaLiquida)} + imóveis ${fmtCompact(ind!.imoveisAPagar)}) ÷ PL ${fmtCompact(ind!.patrimonioLiquido)}`;
        break;
    }
    // apuração anual: a próxima é o 31/12 seguinte à última apuração até a data-base
    const proxima = anual ? `${Number(ap.dataApuracao.slice(0, 4)) + 1}-12-31` : null;
    const waiverTexto =
      ap.status === "excedido"
        ? ap.reclassifica
          ? ` · sem waiver na data-base: ${listar(ap.cov.contratos)} no circulante (CPC 26, item 74)`
          : ap.waiver
            ? ` · waiver do ${ap.waiver.credor} obtido em ${fmtDate(ap.waiver.obtidoEm)}`
            : ""
        : "";
    const estado: ValueState =
      ap.status === "excedido" ? (ap.reclassifica ? "negative" : "critical") : ap.status === "atencao" ? "critical" : "positive";
    const statusTexto =
      ap.status === "ok"
        ? "Cumprido"
        : ap.status === "atencao"
          ? "Em atenção"
          : ap.reclassifica
            ? "Descumprido · sem waiver"
            : ap.waiverVigente
              ? "Descumprido · waiver vigente"
              : "Descumprido";
    out.push({
      def: { ...def, subtitulo: `Covenant ${anual ? "anual" : "trimestral"} · apuração de ${fmtDate(ap.dataApuracao)}` },
      valor: ap.valor,
      referencia: ap.dataApuracao,
      limite: ap.cov.limite,
      atencao: ap.cov.alerta,
      status: ap.status,
      estado,
      statusTexto,
      statusCurto:
        ap.status === "ok" ? "cumprido" : ap.status === "atencao" ? "em atenção" : ap.reclassifica ? "descumprido" : "com waiver",
      desvio: ap.valor - ap.cov.limite,
      folga: ap.cov.tipo === "max" ? ap.cov.limite - ap.valor : ap.valor - ap.cov.limite,
      anterior: ant ? { valor: ant.valor, rotulo: anual ? ant.data.slice(0, 4) : fmtQuarter(ant.data) } : undefined,
      detalhe: base + waiverTexto + (proxima && h.length < 2 ? ` · próxima apuração em ${fmtDate(proxima)}` : ""),
      apuracao: ap,
      prioridade: ap.status === "excedido" ? (ap.reclassifica ? 0 : 2) : ap.status === "atencao" ? 3 : 8,
    });
  }

  // 5. Liquidez
  const cob = coberturaDe(a);
  if (cob !== null) {
    const cobAnt = b ? coberturaDe(b) : null;
    add("coberturaCP", cob, a.data, cobAnt !== null ? { valor: cobAnt, rotulo: rotuloMes } : null, {
      detalhe:
        `(Caixa ${fmtCompact(a.caixa ?? 0)}${a.dataCaixa && a.dataCaixa !== a.data ? ` de ${fmtDate(a.dataCaixa)}` : ""} + aplicações circulantes ${fmtCompact(a.aplicacoesCirculantes)}) ÷ dívida circulante ${fmtCompact(a.circulante)}` +
        (a.reclassificados.length ? " (com a reclassificação do CPC 26, item 74)" : ""),
    });
  }

  if (a.caixa !== null) {
    const liquidez = (f: FotoMensal) => (f.caixa !== null && f.caixa + f.aplicacoes > 0 ? (f.principal12m + f.juros12m) / (f.caixa + f.aplicacoes) : null);
    const vAnt = b ? liquidez(b) : null;
    add("servicoLiquidez", liquidez(a) ?? 0, a.data, vAnt !== null ? { valor: vAnt, rotulo: rotuloMes } : null, {
      detalhe: `Serviço ${fmtCompact(a.principal12m + a.juros12m)} ÷ (caixa ${fmtCompact(a.caixa)} em ${fmtDate(a.dataCaixa)} + aplicações ${fmtCompact(a.aplicacoes)})`,
    });
  }

  const ordem = new Map(DEFINICOES_KPI.map((d, i) => [d.id, i]));
  return out.sort((x, y) => (ordem.get(x.def.id) ?? 0) - (ordem.get(y.def.id) ?? 0));
}

export interface ResumoKpis {
  comMeta: number;
  ok: number;
  atencao: number;
  fora: number;
  /** descumpridos com waiver vigente (contam como fora) */
  comWaiver: number;
  informativos: number;
  estado: ValueState;
  pior: ResultadoKpi | null;
  /** status mais crítico: "ICSD descumprido", "% curto prazo fora da meta"… */
  rodape: string;
}

function resumir(kpis: ResultadoKpi[]): ResumoKpis {
  const comMeta = kpis.filter((k) => k.status !== null);
  const ok = comMeta.filter((k) => k.status === "ok").length;
  const atencao = comMeta.filter((k) => k.status === "atencao").length;
  const fora = comMeta.filter((k) => k.status === "excedido");
  const alertas = [...comMeta.filter((k) => k.status !== "ok")].sort((x, y) => x.prioridade - y.prioridade);
  const pior = alertas[0] ?? null;
  const estado: ValueState = alertas.some((k) => k.estado === "negative") ? "negative" : alertas.length ? "critical" : "positive";
  return {
    comMeta: comMeta.length,
    ok,
    atencao,
    fora: fora.length,
    comWaiver: fora.filter((k) => k.apuracao?.waiverVigente).length,
    informativos: kpis.length - comMeta.length,
    estado,
    pior,
    rodape: pior ? `${pior.def.sigla} ${pior.statusCurto}` : "Todos na meta",
  };
}

/**
 * KPIs na data-base (sem as séries) – a mesma avaliação da tela, usada pelo tile do Launchpad.
 */
export function avaliarKpisCaptacoes(p: PremissasMercado, apuracoes: ApuracaoCovenant[] = apurarCovenants(p.dataBase)) {
  const kpis = montarKpis({
    atual: fotoMensal(p.dataBase, p),
    anterior: null,
    apuracoes,
    trimestres: trimestresAte(p.dataBase).map(indicadoresEm),
    ultimoDado: ultimoDadoNaDataBase(p.dataBase),
  });
  return { kpis, resumo: resumir(kpis) };
}

// ---------------------------------------------------------------------------
// Tendência, laterais e textos
// ---------------------------------------------------------------------------

function tendenciaDe(k: ResultadoKpi): KpiTendencia | undefined {
  if (!k.anterior) return undefined;
  const d = k.valor - k.anterior.valor;
  const nulo = deltaNulo(k.def.unidade, d);
  const direcao: KpiTendencia["direcao"] = nulo ? "flat" : d > 0 ? "up" : "down";
  const favoravel = k.def.favoravel === null || nulo ? null : (direcao === "up") === (k.def.favoravel === "up");
  return {
    texto: nulo ? `estável vs ${k.anterior.rotulo}` : `${fmtDelta(k.def.unidade, d)} vs ${k.anterior.rotulo}`,
    direcao,
    favoravel,
  };
}

function rotuloMeta(def: DefinicaoKpi): string {
  return def.tipo === "covenant" ? "Limite" : def.tipo === "politica" ? "Limite (política)" : def.sobreCDI ? "Meta (CDI + 1,5 p.p.)" : "Meta interna";
}

function lateraisDe(k: ResultadoKpi): KpiIndicadorLateral[] | undefined {
  if (k.status !== null && k.limite !== undefined && k.folga !== undefined) {
    const folgaState: ValueState = k.status === "ok" ? "positive" : k.status === "atencao" ? "critical" : "negative";
    return [
      { label: rotuloMeta(k.def), value: fmtLimite(k.def, k.limite) },
      { label: "Folga", value: fmtDelta(k.def.unidade, k.folga), state: folgaState },
    ];
  }
  return k.laterais?.map((l) => ({ label: l.label, value: l.valor, state: l.state }));
}

/** "10,1% · meta ≤ 25,0% · meta interna (fictícia)" */
function resumoKpi(k: ResultadoKpi): string {
  if (k.limite === undefined) return `${fmtValor(k.def.unidade, k.valor)} · informativo`;
  const palavra = k.def.tipo === "meta" ? "meta" : "limite";
  return `${fmtValor(k.def.unidade, k.valor)} · ${palavra} ${fmtLimite(k.def, k.limite)} · ${ROTULO_TIPO[k.def.tipo]}`;
}

const ORDEM_STATUS = (k: ResultadoKpi) => (k.status === null ? 4 : k.status === "ok" ? 2 : k.status === "atencao" ? 1 : 0);

/** Colunas do cartão auxiliar que completa a linha da grade (4 colunas em xl, 2 em md) */
function colunasRestantes(n: number): string {
  const xl = { 0: "xl:col-span-4", 1: "xl:col-span-3", 2: "xl:col-span-2", 3: "xl:col-span-1" }[n % 4 as 0 | 1 | 2 | 3];
  return clsx(xl, n % 2 === 0 ? "md:col-span-2" : "md:col-span-1");
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function KpisCaptacoes() {
  const { premissas: p } = usePremissas();
  const apuracoes = useCovenants();
  const db = p.dataBase;
  const [modo, setModo] = useState<KpiModo>("cartoes");

  const d = useMemo(() => {
    const meses = lastMonthEnds(db, 12);
    const fotos = meses.map((m) => fotoMensal(m, p));
    const trimestres = trimestresAte(db).map(indicadoresEm);
    const ultimoDado = ultimoDadoNaDataBase(db);
    const atual = fotos[fotos.length - 1];
    const anterior = fotos.length > 1 ? fotos[fotos.length - 2] : null;
    const kpis = montarKpis({ atual, anterior, apuracoes, trimestres, ultimoDado });

    // Séries dos micrográficos
    const mensal = (f: (x: FotoMensal) => number | null) =>
      fotos.flatMap((x) => {
        const y = f(x);
        return y === null || !Number.isFinite(y) ? [] : [{ x: fmtMonthShort(x.data), y }];
      });
    const series: Record<string, { x: string; y: number }[]> = {
      dividaBruta: mensal((x) => x.dividaBruta),
      dividaLiquida: trimestres.map((t) => ({ x: fmtQuarter(t.data), y: t.dividaLiquida })),
      captacoesAno: mensal((x) => x.captacoesAno),
      custoMedio: mensal((x) => x.custoMedio),
      encargosLTM: mensal((x) => x.encargosLTM),
      cetMedio: mensal((x) => x.cetMedio),
      exposicaoCDI: mensal((x) => x.mix.find((m) => m.rotulo === "CDI")?.share ?? null),
      prazoMedio: mensal((x) => x.prazoMedio),
      curtoPrazo: mensal((x) => (x.dividaBruta > 0 ? x.circulante / x.dividaBruta : null)),
      vencimentos12m: mensal((x) => x.principal12m),
      concentracao: mensal((x) => x.fontes[0]?.share ?? null),
      coberturaCP: mensal(coberturaDe),
      servicoLiquidez: mensal((x) => (x.caixa !== null ? (x.principal12m + x.juros12m) / (x.caixa + x.aplicacoes) : null)),
    };
    for (const a of apuracoes) {
      series[`cov-${a.cov.id}`] = a.historico.map((h) => ({ x: a.cov.periodicidade === "Anual" ? h.data.slice(0, 4) : fmtQuarter(h.data), y: h.valor }));
    }

    return { fotos, trimestres, atual, anterior, kpis, series, resumo: resumir(kpis), ultimoDado };
  }, [db, p, apuracoes]);

  const { atual, kpis, resumo } = d;
  const tri = d.trimestres[d.trimestres.length - 1];
  const kCusto = kpis.find((k) => k.def.id === "custoMedio");
  const caso = apuracoes.find((a) => a.reclassifica) ?? apuracoes.find((a) => a.status === "excedido" && a.waiverVigente) ?? null;
  const vsMes = d.anterior ? `vs ${fmtMonthShort(d.anterior.data)}` : "vs mês anterior";

  const irPara = (id: string) => {
    setModo("cartoes");
    requestAnimationFrame(() => document.getElementById(`kpi-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const secaoTitulo = (id: SecaoKpi) => {
    const s = SECOES_KPI.find((x) => x.id === id)!;
    return `${s.numero}. ${s.titulo}`;
  };

  const itensPlacar: KpiPlacarItem[] = kpis.map((k) => ({
    id: k.def.id,
    secao: k.def.secao,
    curto: k.def.sigla,
    nome: k.def.nome,
    state: k.estado,
    statusTexto: k.statusTexto,
    faixa: k.status === null ? null : k.status === "ok" ? "ok" : k.status === "atencao" ? "atencao" : "fora",
    resumo: resumoKpi(k),
    prioridade: k.prioridade,
  }));

  const linhas: KpiLinha[] = kpis.map((k) => ({
    id: k.def.id,
    nome: k.def.nome,
    secao: `${secaoTitulo(k.def.secao)} · ${k.def.periodicidade.toLowerCase()}`,
    formula: k.def.formula,
    valor: fmtValor(k.def.unidade, k.valor),
    valorOrdem: k.valor,
    valorDetalhe: k.def.id === "dividaLiquida" ? `apuração ${fmtQuarter(k.referencia)}` : fmtDate(k.referencia),
    meta: k.limite !== undefined ? fmtLimite(k.def, k.limite) : undefined,
    metaDetalhe: k.limite !== undefined ? ROTULO_TIPO[k.def.tipo] : undefined,
    folga: k.folga !== undefined ? fmtDelta(k.def.unidade, k.folga) : undefined,
    state: k.estado,
    statusTexto: k.statusTexto,
    statusOrdem: ORDEM_STATUS(k),
    tendencia: tendenciaDe(k),
    rota: k.def.rota,
    origem: `${k.def.origem} · ${NOME_ORIGEM[k.def.origem]}`,
  }));

  // -------------------------------------------------------------------------
  // Exportação
  // -------------------------------------------------------------------------

  const exportar = () => {
    const escalaPct = (u: Unidade) => (u === "pct" || u === "pctaa" ? 100 : 1);
    const unidadeTexto: Record<Unidade, string> = { brl: "R$", pctaa: "% a.a.", pct: "%", anos: "anos", x: "x" };
    exportarExcel(
      `KPIs_Captacoes_${db}.xlsx`,
      [
        {
          nome: "KPIs",
          titulo: "Painel de KPIs – Captações financeiras",
          subtitulo: "Consolidado · percentuais em % · folga = distância até a meta/limite (positiva = dentro; p.p. para percentuais)",
          colunas: [
            { titulo: "Seção", largura: 22 },
            { titulo: "KPI", largura: 34 },
            { titulo: "Fórmula", largura: 70 },
            { titulo: "Unidade", largura: 9 },
            { titulo: "Data de referência", tipo: "data", largura: 14 },
            { titulo: "Valor", tipo: "decimal", largura: 18 },
            { titulo: "Tipo de meta", largura: 22 },
            { titulo: "Sentido", largura: 9 },
            { titulo: "Meta / limite", tipo: "decimal", largura: 14 },
            { titulo: "Início da atenção", tipo: "decimal", largura: 14 },
            { titulo: "Folga", tipo: "decimal", largura: 14 },
            { titulo: "Status", largura: 26 },
            { titulo: "Período anterior", largura: 16 },
            { titulo: "Valor anterior", tipo: "decimal", largura: 18 },
            { titulo: "Tendência", largura: 24 },
            { titulo: "Fonte", largura: 18 },
            { titulo: "Detalhe", largura: 90 },
          ],
          linhas: kpis.map((k) => {
            const e = escalaPct(k.def.unidade);
            return [
              secaoTitulo(k.def.secao),
              k.def.nome,
              k.def.formula,
              unidadeTexto[k.def.unidade],
              k.referencia,
              k.valor * e,
              ROTULO_TIPO[k.def.tipo],
              k.def.sentido === "max" ? "Máximo" : k.def.sentido === "min" ? "Mínimo" : "",
              k.limite !== undefined ? k.limite * e : null,
              k.atencao !== undefined ? k.atencao * e : null,
              k.folga !== undefined ? k.folga * e : null,
              k.statusTexto,
              k.anterior?.rotulo ?? "",
              k.anterior ? k.anterior.valor * e : null,
              tendenciaDe(k)?.texto ?? "",
              `${k.def.origem} – ${NOME_ORIGEM[k.def.origem]}`,
              k.detalhe ?? "",
            ];
          }),
          notas: [
            "Metas internas são fictícias (ambiente de demonstração); limites de covenant conforme as escrituras e contratos (C04); cobertura de curto prazo com o limite da política financeira (o mesmo do R06).",
            "Custo médio: meta até o CDI da premissa importada do SAP + 1,5 p.p. Covenants consolidados na última apuração até a data-base.",
            `Dívida líquida: valor da última apuração trimestral (base dos covenants); na data-base ${fmtDate(db)}: ${fmtCompact(dividaLiquidaNaData(atual))}${atual.dataCaixa && atual.dataCaixa !== db ? ` (caixa de ${fmtDate(atual.dataCaixa)})` : ""}.`,
            `Fluxos futuros (vencimentos e serviço da dívida) projetados com o último dado disponível (${fmtDate(d.ultimoDado)}).`,
          ],
        },
        {
          nome: "Séries mensais",
          titulo: "Painel de KPIs – séries de 12 fins de mês",
          subtitulo: "Premissas da data-base (séries históricas importadas do SAP até ela) · valores em R$ e percentuais em %",
          colunas: [
            { titulo: "Fim do mês", tipo: "data", largura: 12 },
            { titulo: "Dívida bruta", tipo: "moeda", largura: 18 },
            { titulo: "Circulante", tipo: "moeda", largura: 18 },
            { titulo: "% curto prazo", tipo: "decimal", largura: 12 },
            { titulo: "Reclassificados (CPC 26)", largura: 16 },
            { titulo: "CDI % a.a.", tipo: "decimal", largura: 11 },
            { titulo: "Custo médio % a.a.", tipo: "decimal", largura: 12 },
            { titulo: "Spread s/ CDI (p.p.)", tipo: "decimal", largura: 12 },
            { titulo: "CET médio % a.a.", tipo: "decimal", largura: 12 },
            { titulo: "Encargos 12 meses", tipo: "moeda", largura: 18 },
            { titulo: "Capitalizados 12 meses (CPC 20)", tipo: "moeda", largura: 18 },
            { titulo: "Captações no ano", tipo: "moeda", largura: 18 },
            { titulo: "Prazo médio (anos)", tipo: "decimal", largura: 12 },
            { titulo: "Principal 12 meses", tipo: "moeda", largura: 18 },
            { titulo: "Juros 12 meses", tipo: "moeda", largura: 18 },
            { titulo: "Maior fonte", largura: 14 },
            { titulo: "Maior fonte %", tipo: "decimal", largura: 12 },
            { titulo: "HHI", tipo: "inteiro", largura: 9 },
            ...MIX_INDEXADOR.map((m) => ({ titulo: `% ${m.rotulo}`, tipo: "decimal" as const, largura: 10 })),
            { titulo: "Aplicações financeiras", tipo: "moeda", largura: 18 },
            { titulo: "Aplicações circulantes", tipo: "moeda", largura: 18 },
            { titulo: "Caixa (último trimestre)", tipo: "moeda", largura: 18 },
            { titulo: "Cobertura de curto prazo (x)", tipo: "decimal", largura: 14 },
            { titulo: "Serviço 12m ÷ liquidez %", tipo: "decimal", largura: 14 },
          ],
          linhas: d.fotos.map((f) => [
            f.data,
            f.dividaBruta,
            f.circulante,
            f.dividaBruta > 0 ? (f.circulante / f.dividaBruta) * 100 : null,
            f.reclassificados.join(", "),
            f.cdi * 100,
            f.custoMedio * 100,
            (f.custoMedio - f.cdi) * 100,
            f.cetMedio * 100,
            f.encargosLTM,
            f.capitalizadosLTM,
            f.captacoesAno,
            f.prazoMedio,
            f.principal12m,
            f.juros12m,
            f.fontes[0]?.rotulo ?? "",
            (f.fontes[0]?.share ?? 0) * 100,
            Math.round(f.hhi),
            ...f.mix.map((m) => m.share * 100),
            f.aplicacoes,
            f.aplicacoesCirculantes,
            f.caixa,
            coberturaDe(f),
            f.caixa !== null ? ((f.principal12m + f.juros12m) / (f.caixa + f.aplicacoes)) * 100 : null,
          ]),
          notas: [
            "Posições pelo custo amortizado com a reclassificação do CPC 26 (item 74) vigente em cada data; meses posteriores ao último dado disponível usam a projeção com taxa constante.",
            "Cobertura de curto prazo = (caixa + aplicações circulantes) ÷ dívida circulante – mesma fórmula do R06 e do painel de Aplicações.",
          ],
        },
        {
          nome: "Séries trimestrais",
          titulo: "Painel de KPIs – dívida líquida e covenants por trimestre",
          subtitulo: "Base de cálculo do C04 · valores em R$; índices em múltiplos (x) e capitalização em %",
          colunas: [
            { titulo: "Trimestre", largura: 10 },
            { titulo: "Data", tipo: "data", largura: 12 },
            { titulo: "Dívida bruta", tipo: "moeda", largura: 18 },
            { titulo: "Caixa", tipo: "moeda", largura: 16 },
            { titulo: "Aplicações financeiras", tipo: "moeda", largura: 18 },
            { titulo: "Dívida líquida", tipo: "moeda", largura: 18 },
            { titulo: "EBITDA 12 meses", tipo: "moeda", largura: 18 },
            { titulo: "Encargos 12 meses", tipo: "moeda", largura: 18 },
            { titulo: "DL/EBITDA (x)", tipo: "decimal", largura: 12 },
            { titulo: "EBITDA/encargos (x)", tipo: "decimal", largura: 12 },
            { titulo: "PL/ativo total (%)", tipo: "decimal", largura: 12 },
            { titulo: "(DL + imóveis)/PL (x)", tipo: "decimal", largura: 14 },
          ],
          linhas: d.trimestres.map((t) => [
            fmtQuarter(t.data),
            t.data,
            t.dividaBruta,
            t.caixa,
            t.aplicacoes,
            t.dividaLiquida,
            t.ebitdaLTM,
            t.encargosLTM,
            t.dlEbitda,
            t.ebitdaDespFin,
            t.capitalizacao * 100,
            t.dlImoveisPl,
          ]),
          notas: [
            "O índice de capitalização e o ICSD são covenants de apuração anual (31/12); a série trimestral do PL/ativo é acompanhamento gerencial.",
            ...apuracoes
              .filter((a) => a.cov.id === "icsd")
              .flatMap((a) => a.historico.map((h) => `ICSD ${h.data.slice(0, 4)}: ${fmtX(h.valor)} (mínimo ${fmtX(a.cov.limite)}).`)),
          ],
        },
        {
          nome: "Definições",
          titulo: "Painel de KPIs – definições",
          colunas: [
            { titulo: "Id", largura: 18 },
            { titulo: "KPI", largura: 34 },
            { titulo: "Seção", largura: 22 },
            { titulo: "Fórmula", largura: 90 },
            { titulo: "Unidade", largura: 9 },
            { titulo: "Tipo de meta", largura: 22 },
            { titulo: "Sentido", largura: 9 },
            { titulo: "Meta / limite", largura: 22 },
            { titulo: "Início da atenção", largura: 18 },
            { titulo: "Periodicidade", largura: 13 },
            { titulo: "Origem", largura: 18 },
          ],
          linhas: DEFINICOES_KPI.map((def) => {
            const ref = (v?: number) =>
              v === undefined ? "" : def.sobreCDI ? `CDI + ${fmtDec(v * 100, 1)} p.p.` : fmtLimite(def, v).replace(/^[≤≥] /, "");
            return [
              def.id,
              def.nome,
              secaoTitulo(def.secao),
              def.formula,
              unidadeTexto[def.unidade],
              ROTULO_TIPO[def.tipo],
              def.sentido === "max" ? "Máximo" : def.sentido === "min" ? "Mínimo" : "",
              def.limite !== undefined ? `${def.sentido === "max" ? "≤" : "≥"} ${ref(def.limite)}` : "",
              ref(def.atencao),
              def.periodicidade,
              `${def.origem} – ${NOME_ORIGEM[def.origem]}`,
            ];
          }),
        },
      ],
      db,
    );
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const cartao = (k: ResultadoKpi) => (
    <div key={k.def.id} id={`kpi-${k.def.id}`} className="flex min-w-0 scroll-mt-24">
      <CartaoKpi k={k} serie={d.series[k.def.id]} foto={atual} />
    </div>
  );

  const secao = (id: SecaoKpi, doGrupo: ResultadoKpi[], extra?: ReactNode, antes?: ReactNode) => {
    const s = SECOES_KPI.find((x) => x.id === id)!;
    const comMeta = doGrupo.filter((k) => k.status !== null);
    const estado: ValueState = comMeta.some((k) => k.estado === "negative") ? "negative" : comMeta.some((k) => k.status !== "ok") ? "critical" : "positive";
    return (
      <KpiSecao
        key={id}
        id={id}
        titulo={secaoTitulo(id)}
        periodo={s.periodo}
        contagem={{ ok: comMeta.filter((k) => k.status === "ok").length, total: comMeta.length, estado }}
        antes={antes}
      >
        {doGrupo.map(cartao)}
        {extra}
      </KpiSecao>
    );
  };
  const doGrupo = (id: SecaoKpi) => kpis.filter((k) => k.def.secao === id);
  const dlNaData = dividaLiquidaNaData(atual);
  const caixaNaData = atual.dataCaixa === db;
  const covenants = doGrupo("covenants");
  const liquidez = doGrupo("liquidez");
  const tamanho = doGrupo("tamanho");

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Dívida bruta" value={fmtCompact(atual.dividaBruta)} sub="Custo amortizado (C00)" />
          {tri && (
            <HeaderKpi
              label="Dívida líquida"
              value={fmtCompact(tri.dividaLiquida)}
              sub={`apuração ${fmtQuarter(tri.data)} · ${fmtX(tri.dlEbitda)} EBITDA`}
            />
          )}
          <HeaderKpi
            label="Custo médio"
            value={fmtPct(atual.custoMedio)}
            unit="a.a."
            state={kCusto?.estado === "positive" ? "neutral" : kCusto?.estado}
            sub={`CDI ${fmtPct(atual.cdi)} · spread ${fmtDelta("pctaa", atual.custoMedio - atual.cdi)}`}
          />
          <HeaderKpi
            label="KPIs na meta"
            value={`${resumo.ok}/${resumo.comMeta}`}
            state={resumo.estado}
            sub={`${resumo.atencao} em atenção · ${resumo.fora} fora da meta`}
          />
        </>
      }
    >
      <KpiPlacar
        subtitulo={`${resumo.comMeta} KPIs com meta ou limite · consolidado · data-base ${fmtDate(db)}`}
        secoes={SECOES_KPI.map((s) => ({ id: s.id, titulo: secaoTitulo(s.id) }))}
        itens={itensPlacar}
        modo={modo}
        onModo={setModo}
        onIr={irPara}
        notaFora={resumo.comWaiver ? `${resumo.comWaiver} com waiver vigente` : undefined}
        rodape={`Metas internas fictícias (ambiente de demonstração), limite da política financeira e limites de covenant conforme escrituras e contratos (C04). Séries com as premissas importadas do SAP; vencimentos e serviço da dívida projetados com o último dado disponível (${fmtDate(d.ultimoDado)}).`}
      />

      {modo === "tabela" ? (
        <KpiTabela
          linhas={linhas}
          subtitulo={`Valor na data-base ou na última apuração · meta/limite · folga · status · tendência ${vsMes} (covenants: vs apuração anterior) · relatório de origem`}
        />
      ) : (
        <>
          {secao(
            "tamanho",
            tamanho,
            <KpiPainel
              className={colunasRestantes(tamanho.length)}
              titulo="Dívida líquida na data-base"
              subtitulo={`Consolidado · ${fmtDate(db)}${atual.dataCaixa && !caixaNaData ? ` · caixa de ${fmtDate(atual.dataCaixa)}` : ""} · R$`}
              rota="/c04-covenants"
              origem="C04 · Covenants"
              rodape={
                tri
                  ? tri.data !== db
                    ? `Apuração ${fmtQuarter(tri.data)} (base dos covenants): dívida líquida ${fmtCompact(tri.dividaLiquida)}`
                    : `Igual à apuração ${fmtQuarter(tri.data)} (base dos covenants) · EBITDA 12m ${fmtCompact(tri.ebitdaLTM)}`
                  : undefined
              }
            >
              <KpiPonte
                base={atual.dividaBruta}
                linhas={[
                  { rotulo: "Dívida bruta", valor: atual.dividaBruta, cor: "#df1278", forte: true },
                  { rotulo: `(−) Caixa${atual.dataCaixa && !caixaNaData ? ` (${fmtDate(atual.dataCaixa)})` : ""}`, valor: atual.caixa ?? 0, cor: "#758ca4" },
                  { rotulo: "(−) Aplicações (valor contábil)", valor: atual.aplicacoes, cor: "#0070f2" },
                  { rotulo: "Dívida líquida", valor: dlNaData, cor: "#8b47d7", forte: true },
                ]}
              />
            </KpiPainel>,
          )}
          {secao("custo", doGrupo("custo"))}
          {secao("prazo", doGrupo("prazo"))}
          {secao(
            "covenants",
            covenants,
            <PainelFolgaCovenants className={colunasRestantes(covenants.length)} kpis={covenants} dataBase={db} />,
            caso ? <FaixaCovenant caso={caso} dataBase={db} reclassificados={atual.reclassificados} /> : undefined,
          )}
          {secao(
            "liquidez",
            liquidez,
            <KpiPainel
              className={colunasRestantes(liquidez.length)}
              titulo="Cobertura de curto prazo na data-base"
              subtitulo={`Consolidado · ${fmtDate(db)}${atual.dataCaixa && !caixaNaData ? ` · caixa de ${fmtDate(atual.dataCaixa)}` : ""} · R$`}
              rota="/c02-cronograma"
              origem="C02 · Vencimentos"
              rodape={`Aplicações não circulantes, fora da cobertura: ${fmtCompact(atual.aplicacoes - atual.aplicacoesCirculantes)}`}
            >
              <KpiPonte
                base={Math.max((atual.caixa ?? 0) + atual.aplicacoesCirculantes, atual.circulante, atual.principal12m + atual.juros12m)}
                linhas={[
                  { rotulo: `Caixa${atual.dataCaixa && !caixaNaData ? ` (${fmtDate(atual.dataCaixa)})` : ""}`, valor: atual.caixa ?? 0, cor: "#758ca4" },
                  { rotulo: "(+) Aplicações circulantes (valor contábil)", valor: atual.aplicacoesCirculantes, cor: "#0070f2" },
                  { rotulo: "Caixa + aplicações circulantes", valor: (atual.caixa ?? 0) + atual.aplicacoesCirculantes, cor: CHART_SEMANTIC.good, forte: true },
                  {
                    rotulo: `Dívida circulante${atual.reclassificados.length ? " (com reclassificação CPC 26)" : ""}`,
                    valor: atual.circulante,
                    cor: "#df1278",
                    forte: true,
                  },
                  { rotulo: "Serviço da dívida – próximos 12 meses", valor: atual.principal12m + atual.juros12m, cor: CHART_SEMANTIC.critical },
                ]}
              />
            </KpiPainel>,
          )}
        </>
      )}
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Cartão de KPI
// ---------------------------------------------------------------------------

function CartaoKpi({ k, serie, foto }: { k: ResultadoKpi; serie?: { x: string; y: number }[]; foto: FotoMensal }) {
  const { valor, unidade } = partesValor(k.def.unidade, k.valor);
  const detalhe: ReactNode =
    k.def.id === "exposicaoCDI" ? (
      <BarraFatias fatias={foto.mix} />
    ) : k.def.id === "concentracao" ? (
      <>
        <BarraFatias fatias={foto.fontes.slice(0, 3)} resto={foto.fontes.slice(3)} />
        <div className="mt-1">{k.detalhe}</div>
      </>
    ) : (
      k.detalhe
    );
  return (
    <KpiCard
      className="flex-1"
      titulo={k.def.nome}
      subtitulo={k.def.subtitulo}
      valor={valor}
      unidade={unidade}
      state={k.estado}
      tendencia={tendenciaDe(k)}
      laterais={lateraisDe(k)}
      serie={serie}
      referencia={k.limite}
      status={{ state: k.estado, texto: k.statusTexto }}
      rota={k.def.rota}
      origem={`${k.def.origem} · ${NOME_ORIGEM[k.def.origem]}`}
      detalhe={detalhe}
    />
  );
}

/** Barra segmentada (mix por indexador / fontes) com legenda */
function BarraFatias({ fatias, resto = [] }: { fatias: Fatia[]; resto?: Fatia[] }) {
  const outros = resto.reduce((s, f) => s + f.share, 0);
  const itens = outros > 0 ? [...fatias, { rotulo: "Outros", saldo: 0, share: outros, cor: "#a8b2bd" }] : fatias;
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-[#e5e5e5] gap-px" aria-hidden>
        {itens
          .filter((f) => f.share > 0.0005)
          .map((f) => (
            <div key={f.rotulo} style={{ width: `${f.share * 100}%`, backgroundColor: f.cor }} title={`${f.rotulo}: ${fmtPct(f.share, 1)}`} />
          ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {itens.map((f) => (
          <li key={f.rotulo} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: f.cor }} />
            {f.rotulo}
            <span className="tabular font-semibold text-text">{fmtPct(f.share, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Folga dos covenants (cartão auxiliar da seção 4)
// ---------------------------------------------------------------------------

const COR_ESTADO: Record<ValueState, string> = {
  positive: "#30914c",
  critical: "#e26300",
  negative: "#f53232",
  information: "#0070f2",
  neutral: "#758ca4",
};

const COR_TEXTO: Record<ValueState, string> = {
  positive: "#256f3a",
  critical: "#b44f00",
  negative: "#aa0808",
  information: "#0070f2",
  neutral: "#1d2d3e",
};

/** Folga de cada covenant em % do limite, com a marca do início da faixa de atenção */
function PainelFolgaCovenants({ kpis, dataBase, className }: { kpis: ResultadoKpi[]; dataBase: string; className?: string }) {
  const prox = proximasApuracoes(dataBase);
  const linhas = kpis
    .filter((k) => k.apuracao && k.limite !== undefined && k.atencao !== undefined)
    .map((k) => {
      const lim = k.limite!;
      const folgaRel = (k.folga ?? 0) / Math.abs(lim);
      const atencaoRel = Math.abs(k.atencao! - lim) / Math.abs(lim);
      return { k, folgaRel, atencaoRel };
    });
  const escala = Math.max(1, ...linhas.map((l) => l.folgaRel));
  return (
    <KpiPainel
      className={className}
      titulo="Folga dos covenants"
      subtitulo="Distância até o limite contratual, em % do limite · última apuração · marca = início da faixa de atenção"
      rota="/c04-covenants"
      origem="C04 · Covenants"
      rodape={`Próximas apurações: trimestral em ${fmtDate(prox.trimestral)} · anual em ${fmtDate(prox.anual)}`}
    >
      <ul className="space-y-3">
        {linhas.map(({ k, folgaRel, atencaoRel }) => (
          <li key={k.def.id} className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
              <span className="min-w-0 truncate">
                <span className="font-semibold text-text">{k.def.sigla}</span>
                <span className="text-label"> · {k.def.periodicidade === "Anual" ? k.referencia.slice(0, 4) : fmtQuarter(k.referencia)}</span>
              </span>
              <span className="tabular whitespace-nowrap">
                <span className="text-label">
                  {fmtValor(k.def.unidade, k.valor)} · limite {fmtLimite(k.def, k.limite!)}
                </span>{" "}
                <span className="font-semibold" style={{ color: COR_TEXTO[k.estado] }}>
                  {folgaRel < 0 ? "−" : "+"}
                  {fmtDec(Math.abs(folgaRel) * 100, 0)}%
                </span>
              </span>
            </div>
            <div className="mt-1 relative h-2 rounded-full bg-[#eef0f2]">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${folgaRel > 0 ? Math.max(1.5, (folgaRel / escala) * 100) : 1.5}%`, backgroundColor: COR_ESTADO[k.estado] }}
              />
              <div className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded bg-[#1d2d3e]" style={{ left: `${Math.min(100, (atencaoRel / escala) * 100)}%` }} aria-hidden />
            </div>
          </li>
        ))}
      </ul>
    </KpiPainel>
  );
}

// ---------------------------------------------------------------------------
// Faixa de covenant (descumprimento / waiver)
// ---------------------------------------------------------------------------

function FaixaCovenant({ caso, dataBase, reclassificados }: { caso: ApuracaoCovenant; dataBase: string; reclassificados: string[] }) {
  if (!caso.dataApuracao) return null;
  const nome = caso.cov.id === "icsd" ? "ICSD" : caso.cov.indicador;
  const periodo = caso.cov.periodicidade === "Anual" ? `de ${caso.dataApuracao.slice(0, 4)}` : `de ${fmtQuarter(caso.dataApuracao)}`;
  const valor = caso.cov.formato === "pct" ? fmtPct(caso.valor, 1) : fmtX(caso.valor);
  const limite = caso.cov.formato === "pct" ? fmtPct(caso.cov.limite, 0) : fmtX(caso.cov.limite);
  const minMax = caso.cov.tipo === "max" ? "máximo" : "mínimo";
  if (caso.reclassifica) {
    return (
      <MessageStrip design="negative">
        <strong>
          {nome} {periodo}
        </strong>{" "}
        apurado em <strong>{valor}</strong> ({minMax} {limite}) sem waiver até a data do balanço: o não circulante de {listar(reclassificados)} foi
        reclassificado para o circulante (CPC 26, item 74), o que eleva a parcela de curto prazo.
        {caso.waiver && ` O waiver do ${caso.waiver.credor}, obtido em ${fmtDate(caso.waiver.obtidoEm)}, é evento subsequente sem ajuste (CPC 24).`}{" "}
        <Link to="/c04-covenants" state={{ aba: "classificacao" }} className="text-link font-semibold hover:underline whitespace-nowrap">
          Ver C04
        </Link>
      </MessageStrip>
    );
  }
  return (
    <MessageStrip design="information">
      {nome} {periodo} ({valor}) abaixo do {minMax} de {limite}, com{" "}
      <strong>
        waiver do {caso.waiver?.credor} obtido em {fmtDate(caso.waiver?.obtidoEm)}
      </strong>
      : sem vencimento antecipado em {fmtDate(dataBase)}, {listar(caso.cov.contratos)} seguem o cronograma contratual.{" "}
      <Link to="/c04-covenants" state={{ aba: "classificacao" }} className="text-link font-semibold hover:underline whitespace-nowrap">
        Ver C04
      </Link>
    </MessageStrip>
  );
}
