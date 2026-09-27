import clsx from "clsx";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, SegmentedButton, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, CHART_COLORS, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import {
  addDays,
  diffDays,
  fmtDate,
  fmtMonthLong,
  fmtMonthShort,
  fmtQuarter,
  lastMonthEnds,
  monthOf,
  previousYearEnd,
  yearOf,
} from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../../shared/lib/format";
import { ESCOPOS, useDivida, type Escopo } from "../context/useDivida";
import { relatorioCaptacao } from "../data/catalogo";
import { GRUPO_MODALIDADE, type ContratoDivida } from "../data/contratos";
import { diferencaRollforward, movimentacaoDivida, totalDivida, type CamposMov, type MovContrato } from "../lib/divida";

const rel = relatorioCaptacao("c01");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };
/** Tolerância de fechamento do roll-forward e da conferência com a carteira (R$) */
const TOLERANCIA = 1;
const ORDEM_GRUPOS = ["BNDES", "Debêntures", "CRA", "CRI", "CCB"];

const COR_SALDO = CHART_COLORS[6];
const COR_AUMENTO = CHART_COLORS[1];
const COR_REDUCAO = CHART_COLORS[5];

// ---------------------------------------------------------------------------
// Período de apuração (helper idêntico no C01 e no C03)
// ---------------------------------------------------------------------------

type Periodo = "mes" | "trimestre" | "exercicio" | "12m";

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "mes", label: "Mês" },
  { value: "trimestre", label: "Trimestre" },
  { value: "exercicio", label: "Exercício" },
  { value: "12m", label: "12 meses" },
];

interface PeriodoApuracao {
  /** data do saldo de abertura (fim do período anterior); os encargos correm do dia seguinte até a data-base */
  inicio: string;
  fim: string;
  dias: number;
  /** "1º trimestre de 2026", "Exercício de 2026 (jan a mar)" */
  descricao: string;
  /** "1T26", "mar/26" – KPIs */
  curto: string;
  /** "31/12/2025 a 31/03/2026 · 90 dias" – mesmo formato no C01 e no C03 */
  rotulo: string;
}

/**
 * Mês = mês da data-base; Trimestre = trimestre civil até a data-base; Exercício = desde 31/12 do ano anterior;
 * 12 meses = os 12 meses encerrados na data-base.
 */
function periodoApuracao(periodo: Periodo, dataBase: string): PeriodoApuracao {
  const mes = monthOf(dataBase);
  const ano = yearOf(dataBase);
  const mesesNoTrimestre = ((mes - 1) % 3) + 1;
  const inicio =
    periodo === "mes"
      ? lastMonthEnds(dataBase, 2)[0]
      : periodo === "trimestre"
        ? lastMonthEnds(dataBase, mesesNoTrimestre + 1)[0]
        : periodo === "exercicio"
          ? previousYearEnd(dataBase)
          : lastMonthEnds(dataBase, 13)[0];
  const dias = diffDays(inicio, dataBase);
  const mesAbrev = fmtMonthShort(dataBase).slice(0, 3);
  const mesLongo = fmtMonthLong(dataBase);
  const [descricao, curto] =
    periodo === "mes"
      ? [mesLongo.charAt(0).toUpperCase() + mesLongo.slice(1), fmtMonthShort(dataBase)]
      : periodo === "trimestre"
        ? [`${Math.ceil(mes / 3)}º trimestre de ${ano}${mesesNoTrimestre < 3 ? ` (até ${mesAbrev})` : ""}`, fmtQuarter(dataBase)]
        : periodo === "exercicio"
          ? [mes === 12 ? `Exercício de ${ano}` : `Exercício de ${ano} (${mes === 1 ? "jan" : `jan a ${mesAbrev}`})`, `Exercício ${ano}`]
          : [`12 meses (${fmtMonthShort(addDays(inicio, 1))} a ${fmtMonthShort(dataBase)})`, "12 meses"];
  return { inicio, fim: dataBase, dias, descricao, curto, rotulo: `${fmtDate(inicio)} a ${fmtDate(dataBase)} · ${dias} dias` };
}

function PeriodoInfo({ per }: { per: PeriodoApuracao }) {
  return (
    <div className="min-w-0 lg:ml-auto lg:text-right">
      <div className="text-[13px] text-label">Período de apuração</div>
      <div className="text-sm font-semibold text-text mt-0.5">{per.descricao}</div>
      <div className="text-xs text-label tabular">{per.rotulo}</div>
    </div>
  );
}

type Visao = "modalidade" | "contrato";

// ---------------------------------------------------------------------------
// Etapas da movimentação
// ---------------------------------------------------------------------------

type CampoEtapa = Exclude<CamposMov, "capitalizados">;

interface Etapa {
  campo: CampoEtapa;
  rotulo: (inicio: string, fim: string) => string;
  /** rótulo curto (cabeçalho da visão por contrato e gráfico) */
  curto: string;
  /** cabeçalho compacto da visão por contrato (o nome completo vai no tooltip) */
  cab: string;
  grafico: [string, string?];
  saldo?: boolean;
}

const ETAPAS: Etapa[] = [
  { campo: "saldoInicial", rotulo: (i) => `Saldo em ${fmtDate(i)}`, curto: "Saldo inicial", cab: "Saldo inicial", grafico: ["Saldo", "inicial"], saldo: true },
  { campo: "captacoes", rotulo: () => "(+) Captações", curto: "Captações", cab: "Captações", grafico: ["Captações"] },
  { campo: "custosTransacao", rotulo: () => "(−) Custos de transação", curto: "(−) Custos de transação", cab: "(−) Custos", grafico: ["Custos de", "transação"] },
  { campo: "juros", rotulo: () => "(+) Juros apropriados", curto: "Juros apropriados", cab: "Juros", grafico: ["Juros", "apropriados"] },
  { campo: "atualizacaoMonetaria", rotulo: () => "(+) Atualização monetária", curto: "Atualização monetária", cab: "Atualização", grafico: ["Atualização", "monetária"] },
  { campo: "apropriacaoCustos", rotulo: () => "(+) Apropriação de custos de transação", curto: "Apropriação de custos", cab: "Apropr. custos", grafico: ["Apropriação", "de custos"] },
  { campo: "pagamentoPrincipal", rotulo: () => "(−) Pagamento de principal", curto: "(−) Principal pago", cab: "(−) Principal", grafico: ["Pagamento", "de principal"] },
  { campo: "pagamentoJuros", rotulo: () => "(−) Pagamento de juros", curto: "(−) Juros pagos", cab: "(−) Juros pagos", grafico: ["Pagamento", "de juros"] },
  { campo: "saldoFinal", rotulo: (_, f) => `Saldo em ${fmtDate(f)}`, curto: "Saldo final", cab: "Saldo final", grafico: ["Saldo", "final"], saldo: true },
];

const LINHA_ENCARGOS = "(=) Encargos apropriados";
const DESC_ENCARGOS = "juros + atualização monetária + apropriação de custos";
const LINHA_CPC20 = "dos quais capitalizados em ativo qualificável (CPC 20)";

type Totais = Record<CamposMov, number>;

function somar(linhas: MovContrato[]): Totais {
  const out = {} as Totais;
  for (const k of [...ETAPAS.map((e) => e.campo), "capitalizados"] as CamposMov[]) out[k] = linhas.reduce((s, l) => s + l[k], 0);
  return out;
}

function grupoDe(c: ContratoDivida): string {
  return GRUPO_MODALIDADE[c.modalidade];
}

function ordemContrato(a: MovContrato, b: MovContrato): number {
  const g = ORDEM_GRUPOS.indexOf(grupoDe(a.c)) - ORDEM_GRUPOS.indexOf(grupoDe(b.c));
  return g !== 0 ? g : a.c.id.localeCompare(b.c.id);
}

/** Sinal explícito com o menos tipográfico: +R$ 15,7 mi / −R$ 4,3 mi (sem sinal quando o valor exibido é zero) */
function comSinal(v: number, fmt: (x: number) => string): string {
  const txt = fmt(Math.abs(v));
  if (v === 0 || txt === fmt(0)) return txt;
  return `${v > 0 ? "+" : "−"}${txt}`;
}

// ---------------------------------------------------------------------------
// Arredondamento controlado (tabelas em R$ mil que fecham nas linhas e nas colunas)
// ---------------------------------------------------------------------------

interface TabelaArredondada {
  celulas: number[][];
  /** total de cada linha */
  linhas: number[];
  /** total de cada coluna */
  colunas: number[];
  geral: number;
}

/**
 * Arredonda uma tabela (valores já na unidade exibida, ex.: R$ mil) para inteiros de modo que cada linha some o seu
 * total, cada coluna some o seu total e os totais somem o total geral – o arredondamento controlado das notas
 * explicativas. Cada célula fica no piso ou no teto do valor exato (valores inteiros, como 25.000, não mudam) e os
 * ajustes vão para as células com resto mais próximo de 0,5 (fluxo de custo mínimo). `alvos` fixa totais já exibidos
 * em outras tabelas; se não houver solução com eles, são relaxados em ±1 como último recurso.
 */
function arredondarTabela(
  valores: number[][],
  alvos: { linhas?: (number | undefined)[]; colunas?: (number | undefined)[]; geral?: number } = {},
): TabelaArredondada {
  const nL = valores.length;
  const nC = nL ? valores[0].length : 0;
  const somaL = valores.map((l) => l.reduce((s, v) => s + v, 0));
  const somaC = Array.from({ length: nC }, (_, j) => valores.reduce((s, l) => s + l[j], 0));
  const geral = alvos.geral ?? Math.round(somaL.reduce((s, v) => s + v, 0));

  // Nós: 0 = origem dos totais de linha, 1 = destino dos totais de coluna, linhas, colunas, fonte e sumidouro
  const L = (i: number) => 2 + i;
  const C = (j: number) => 2 + nL + j;
  const S = 2 + nL + nC;
  const T = S + 1;
  const excesso = new Array<number>(T + 1).fill(0);
  interface Var {
    x: number;
  }
  interface Arco {
    de: number;
    para: number;
    cap: number;
    custo: number;
    rev: number;
    v?: Var;
    d?: number;
  }
  const arcos: Arco[] = [];
  const adj: number[][] = Array.from({ length: T + 1 }, () => []);
  const arco = (de: number, para: number, cap: number, custo: number, v?: Var, d?: number) => {
    adj[de].push(arcos.length);
    arcos.push({ de, para, cap, custo, rev: arcos.length + 1, v, d });
    adj[para].push(arcos.length);
    arcos.push({ de: para, para: de, cap: 0, custo: -custo, rev: arcos.length - 1 });
  };
  /** Variável = fluxo de `de` para `para`; passos de ±1 com custos crescentes (convexos) */
  const variavel = (de: number, para: number, exato: number, alvo: number | undefined, peso: number): Var => {
    const x = alvo ?? Math.round(exato);
    const v: Var = { x };
    excesso[de] -= x;
    excesso[para] += x;
    const resto = exato - x;
    const passo = (d: number, custo: number) => (d > 0 ? arco(de, para, 1, custo, v, 1) : arco(para, de, 1, custo, v, -1));
    const ambos = (custo: number) => [1, -1].forEach((d) => passo(d, custo));
    const fracao = Math.abs(resto) > 1e-7;
    if (alvo !== undefined) {
      // total já exibido em outra tabela: só muda se não houver outra saída
      for (let k = 1; k <= 3; k++) ambos(1e7 * k);
    } else if (peso > 1) {
      // total: piso ou teto do valor exato; afastar-se mais, só como último recurso
      if (fracao) passo(resto > 0 ? 1 : -1, peso + 1 - 2 * Math.abs(resto));
      for (let k = 1; k <= 3; k++) ambos(1e5 * k);
    } else if (fracao) {
      // célula: piso ou teto; valores inteiros (ex.: 25.000 captados) nunca mudam
      passo(resto > 0 ? 1 : -1, peso + 1 - 2 * Math.abs(resto));
      ambos(1e5);
    }
    return v;
  };

  const vl = somaL.map((s, i) => variavel(0, L(i), s, alvos.linhas?.[i], 50));
  const vc = somaC.map((s, j) => variavel(C(j), 1, s, alvos.colunas?.[j], 50));
  const cel = valores.map((l, i) => l.map((a, j) => variavel(L(i), C(j), a, undefined, 1)));
  excesso[0] += geral;
  excesso[1] -= geral;
  for (let n = 0; n < S; n++) {
    if (excesso[n] > 0) arco(S, n, excesso[n], 0);
    else if (excesso[n] < 0) arco(n, T, -excesso[n], 0);
  }

  // Caminhos mínimos sucessivos (Bellman-Ford; a tabela tem poucas dezenas de nós)
  for (let it = 0; it < 1000; it++) {
    const dist = new Array<number>(T + 1).fill(Infinity);
    const via = new Array<number>(T + 1).fill(-1);
    dist[S] = 0;
    for (let rodada = 0; rodada <= T; rodada++) {
      let mudou = false;
      for (let k = 0; k < arcos.length; k++) {
        const a = arcos[k];
        if (a.cap > 0 && dist[a.de] + a.custo < dist[a.para] - 1e-9) {
          dist[a.para] = dist[a.de] + a.custo;
          via[a.para] = k;
          mudou = true;
        }
      }
      if (!mudou) break;
    }
    if (dist[T] === Infinity) break;
    let f = Infinity;
    for (let n = T; n !== S; n = arcos[via[n]].de) f = Math.min(f, arcos[via[n]].cap);
    for (let n = T; n !== S; n = arcos[via[n]].de) {
      const a = arcos[via[n]];
      a.cap -= f;
      arcos[a.rev].cap += f;
    }
  }
  for (const a of arcos) if (a.v && a.d) a.v.x += a.d * (arcos[a.rev].cap);

  return { celulas: cel.map((l) => l.map((v) => v.x)), linhas: vl.map((v) => v.x), colunas: vc.map((v) => v.x), geral };
}

/** Rateia `alvo` entre as parcelas arredondadas (maior resto), sem alterar parcelas inteiras */
function ratear(valores: number[], alvo?: number): number[] {
  const alvoFinal = alvo ?? Math.round(valores.reduce((s, v) => s + v, 0));
  return arredondarTabela([valores], { linhas: [alvoFinal], geral: alvoFinal }).celulas[0];
}

/** Valor já arredondado em R$ mil (inteiro): negativos entre parênteses, zero como "–" */
function fmtK(v: number): string {
  return fmtNum(v, { parens: true, dash: true });
}

/** Campos que somam o saldo final: saldo inicial + movimentações */
const CAMPOS_SOMA = ETAPAS.filter((e) => e.campo !== "saldoFinal").map((e) => e.campo);

/** Valores inteiros em R$ mil de uma coluna (modalidade, contrato ou total) da movimentação */
type Mil = Record<CampoEtapa | "encargos" | "capitalizados", number>;

function registroMil(celulas: number[], saldoFinal: number, capitalizados: number): Mil {
  const r = { saldoFinal, capitalizados } as Mil;
  CAMPOS_SOMA.forEach((c, k) => (r[c] = celulas[k] ?? 0));
  r.encargos = r.juros + r.atualizacaoMonetaria + r.apropriacaoCustos;
  return r;
}

/**
 * Movimentação em R$ mil que fecha nas linhas e nas colunas: por modalidade (saldo inicial e saldo final totais
 * iguais aos da carteira arredondada) e por contrato (totais por etapa iguais aos da visão por modalidade).
 */
function movimentacaoMil(grupos: { grupo: string; t: Totais }[], linhas: MovContrato[], t: Totais) {
  const k = (v: number) => v / 1000;
  const capTotal = Math.round(k(t.capitalizados));
  if (!grupos.length) return { porGrupo: new Map<string, Mil>(), porContrato: new Map<string, Mil>(), total: registroMil([], 0, 0) };
  const g = arredondarTabela(
    grupos.map((x) => CAMPOS_SOMA.map((c) => k(x.t[c]))),
    { colunas: [Math.round(k(t.saldoInicial))], geral: Math.round(k(t.saldoFinal)) },
  );
  const capG = ratear(grupos.map((x) => k(x.t.capitalizados)), capTotal);
  const ct = arredondarTabela(
    linhas.map((l) => CAMPOS_SOMA.map((c) => k(l[c]))),
    { colunas: g.colunas, geral: g.geral },
  );
  const capC = ratear(linhas.map((l) => k(l.capitalizados)), capTotal);
  return {
    porGrupo: new Map(grupos.map((x, i) => [x.grupo, registroMil(g.celulas[i], g.linhas[i], capG[i])])),
    porContrato: new Map(linhas.map((l, i) => [l.c.id, registroMil(ct.celulas[i], ct.linhas[i], capC[i])])),
    total: registroMil(g.colunas, g.geral, capTotal),
  };
}

// ---------------------------------------------------------------------------
// Reconciliação com a DFC
// ---------------------------------------------------------------------------

interface Reconciliacao {
  captacoesLiquidas: number;
  principalPago: number;
  jurosPagos: number;
  caixa: number;
  jurosResultado: number;
  atualizacaoResultado: number;
  custosResultado: number;
  capitalizados: number;
  naoCaixa: number;
  variacao: number;
}

/**
 * Separa os encargos do período entre resultado e ativo qualificável. O motor informa, por contrato, o total
 * capitalizado (juros + atualização + apropriação de custos no período de construção); a parcela é distribuída
 * proporcionalmente entre os três encargos do próprio contrato.
 */
function reconciliar(linhas: MovContrato[], t: Totais): Reconciliacao {
  let jurosCap = 0;
  let atualizacaoCap = 0;
  let custosCap = 0;
  for (const l of linhas) {
    const encargos = l.juros + l.atualizacaoMonetaria + l.apropriacaoCustos;
    if (l.capitalizados <= 0 || encargos <= 0) continue;
    const f = l.capitalizados / encargos;
    jurosCap += l.juros * f;
    atualizacaoCap += l.atualizacaoMonetaria * f;
    custosCap += l.apropriacaoCustos * f;
  }
  const captacoesLiquidas = t.captacoes + t.custosTransacao;
  const caixa = captacoesLiquidas + t.pagamentoPrincipal + t.pagamentoJuros;
  const jurosResultado = t.juros - jurosCap;
  const atualizacaoResultado = t.atualizacaoMonetaria - atualizacaoCap;
  const custosResultado = t.apropriacaoCustos - custosCap;
  const naoCaixa = jurosResultado + atualizacaoResultado + custosResultado + t.capitalizados;
  return {
    captacoesLiquidas,
    principalPago: t.pagamentoPrincipal,
    jurosPagos: t.pagamentoJuros,
    caixa,
    jurosResultado,
    atualizacaoResultado,
    custosResultado,
    capitalizados: t.capitalizados,
    naoCaixa,
    variacao: caixa + naoCaixa,
  };
}

/** Reconciliação em R$ mil com os mesmos valores da tabela de movimentação (fecha por construção) */
function reconciliarMil(r: Reconciliacao, m: Mil): Reconciliacao {
  const captacoesLiquidas = m.captacoes + m.custosTransacao;
  const caixa = captacoesLiquidas + m.pagamentoPrincipal + m.pagamentoJuros;
  const [jurosResultado, atualizacaoResultado, custosResultado] = ratear(
    [r.jurosResultado / 1000, r.atualizacaoResultado / 1000, r.custosResultado / 1000],
    m.encargos - m.capitalizados,
  );
  return {
    captacoesLiquidas,
    principalPago: m.pagamentoPrincipal,
    jurosPagos: m.pagamentoJuros,
    caixa,
    jurosResultado,
    atualizacaoResultado,
    custosResultado,
    capitalizados: m.capitalizados,
    naoCaixa: m.encargos,
    variacao: caixa + m.encargos,
  };
}

// ---------------------------------------------------------------------------
// Eventos do período (captações, liquidações e amortizações de principal)
// ---------------------------------------------------------------------------

interface EventoPeriodo {
  chave: string;
  tipo: "Captação" | "Liquidação" | "Amortização";
  c: ContratoDivida;
  data: string;
  detalhe: string;
  /** efeito no saldo (R$): + captação, − pagamentos */
  valor: number;
}

const COR_EVENTO: Record<EventoPeriodo["tipo"], string> = {
  Captação: "#0070f2",
  Liquidação: "#256f3a",
  Amortização: "#556b82",
};

function eventosDoPeriodo(linhas: MovContrato[], inicio: string, fim: string): EventoPeriodo[] {
  const out: EventoPeriodo[] = [];
  for (const l of linhas) {
    const c = l.c;
    if (l.captacoes > 0) {
      out.push({
        chave: `cap-${c.id}`,
        tipo: "Captação",
        c,
        data: c.dataCaptacao,
        detalhe: `custos de transação ${fmtCompact(-l.custosTransacao)} · líquido ${fmtCompact(l.captacoes + l.custosTransacao)}`,
        valor: l.captacoes,
      });
    }
    const liquidado = c.vencimento > inicio && c.vencimento <= fim;
    if (liquidado) {
      out.push({
        chave: `liq-${c.id}`,
        tipo: "Liquidação",
        c,
        data: c.vencimento,
        detalhe: `principal ${fmtCompact(-l.pagamentoPrincipal)} + juros ${fmtCompact(-l.pagamentoJuros)}`,
        valor: l.pagamentoPrincipal + l.pagamentoJuros,
      });
      continue;
    }
    const parcelas = c.amortizacoes.filter((a) => a.data > inicio && a.data <= fim);
    if (parcelas.length && l.pagamentoPrincipal < 0) {
      out.push({
        chave: `amo-${c.id}`,
        tipo: "Amortização",
        c,
        data: parcelas[parcelas.length - 1].data,
        detalhe:
          parcelas.length === 1
            ? `parcela de ${fmtDate(parcelas[0].data)}`
            : `${parcelas.length} parcelas de ${fmtDate(parcelas[0].data)} a ${fmtDate(parcelas[parcelas.length - 1].data)}`,
        valor: l.pagamentoPrincipal,
      });
    }
  }
  return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.c.id.localeCompare(b.c.id)));
}

// ---------------------------------------------------------------------------
// Gráfico waterfall
// ---------------------------------------------------------------------------

interface Degrau {
  chave: CampoEtapa;
  rotulo: string;
  linhas: [string, string?];
  valor: number;
  tipo: "saldo" | "aumento" | "reducao";
  /** barra flutuante [mínimo, máximo] em R$ milhões */
  faixa: [number, number];
  /** nível do saldo após a etapa (R$ milhões) */
  nivel: number;
}

/** Escala "redonda" para o eixo de valores (R$ milhões), truncada abaixo do menor nível do saldo */
function escala(min: number, max: number, folgaSup: number): { lo: number; hi: number; ticks: number[] } {
  const amplitude = Math.max(max - min, 0.5);
  const bruto = amplitude / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= bruto) ?? 10 * mag;
  const lo = Math.max(0, Math.floor((min - amplitude * 0.25) / passo) * passo);
  const hi = Math.ceil((max + amplitude * folgaSup) / passo) * passo;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + passo / 1000; v += passo) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}

function montarDegraus(t: Totais) {
  const mi = (v: number) => v / 1e6;
  const brutos = ETAPAS.map((e) => ({ e, valor: t[e.campo] }));
  let nivel = mi(t.saldoInicial);
  const niveis: number[] = [nivel];
  for (const { e, valor } of brutos) {
    if (e.saldo) continue;
    nivel += mi(valor);
    niveis.push(nivel);
  }
  niveis.push(mi(t.saldoFinal));
  return { brutos, min: Math.min(...niveis), max: Math.max(...niveis) };
}

function degraus(t: Totais, lo: number): Degrau[] {
  const mi = (v: number) => v / 1e6;
  let nivel = mi(t.saldoInicial);
  return ETAPAS.map((e) => {
    const valor = t[e.campo];
    if (e.saldo) {
      nivel = mi(valor);
      return { chave: e.campo, rotulo: e.curto, linhas: e.grafico, valor, tipo: "saldo", faixa: [lo, mi(valor)], nivel };
    }
    const inicio = nivel;
    nivel += mi(valor);
    return {
      chave: e.campo,
      rotulo: e.curto.replace("(−) ", ""),
      linhas: e.grafico,
      valor,
      tipo: valor >= 0 ? "aumento" : "reducao",
      faixa: [Math.min(inicio, nivel), Math.max(inicio, nivel)],
      nivel,
    };
  });
}

function corDegrau(d: Degrau): string {
  return d.tipo === "saldo" ? COR_SALDO : d.tipo === "aumento" ? COR_AUMENTO : COR_REDUCAO;
}

function useMediaQuery(query: string): boolean {
  const [ok, setOk] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOk(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return ok;
}

interface PropsRotulo {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  index?: number;
}

interface PropsTick {
  x?: number;
  y?: number;
  payload?: { value: string };
}

function Waterfall({ t, estreito }: { t: Totais; estreito: boolean }) {
  const { min, max } = montarDegraus(t);
  const { lo, hi, ticks } = escala(min, max, estreito ? 0.45 : 0.18);
  const dados = degraus(t, lo);
  const amplitude = max - min;
  const casas = amplitude < 5 ? 2 : 1;
  const porChave = new Map(dados.map((d) => [d.chave, d]));
  // Rótulos arredondados que fecham: saldo inicial + movimentações = saldo final (maior resto)
  const escalaRotulo = 10 ** casas;
  const unid = (v: number) => (v / 1e6) * escalaRotulo;
  const [si, sf] = [Math.round(unid(t.saldoInicial)), Math.round(unid(t.saldoFinal))];
  const movs = ETAPAS.filter((e) => !e.saldo).map((e) => e.campo);
  const movsRot = ratear(movs.map((c) => unid(t[c])), sf - si);
  const valorRotulo = new Map<CampoEtapa, number>([["saldoInicial", si], ["saldoFinal", sf], ...movs.map((c, i): [CampoEtapa, number] => [c, movsRot[i]])]);

  const textoRotulo = (d: Degrau) => {
    const v = (valorRotulo.get(d.chave) ?? 0) / escalaRotulo;
    if (d.tipo === "saldo") return fmtDec(v, casas);
    if (Math.abs(d.valor) < 1) return "–";
    return comSinal(v, (x) => fmtDec(x, casas));
  };

  const rotulo = (props: PropsRotulo) => {
    const d = dados[props.index ?? 0];
    if (!d) return null;
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const w = Number(props.width ?? 0);
    const h = Number(props.height ?? 0);
    const comum = { fontSize: estreito ? 11 : 12, fontFamily: "72, Arial, sans-serif", fontWeight: d.tipo === "saldo" ? 700 : 600 };
    if (estreito) {
      const direita = Math.max(x, x + w);
      return (
        <text x={direita + 5} y={y + h / 2} dy={4} textAnchor="start" fill="#1d2d3e" {...comum}>
          {textoRotulo(d)}
        </text>
      );
    }
    const topo = Math.min(y, y + h);
    return (
      <text x={x + w / 2} y={topo - 6} textAnchor="middle" fill="#1d2d3e" {...comum}>
        {textoRotulo(d)}
      </text>
    );
  };

  const tickCategoria = ({ x = 0, y = 0, payload }: PropsTick) => {
    const d = porChave.get(payload?.value as CampoEtapa);
    if (!d) return <g />;
    const [l1, l2] = d.linhas;
    if (estreito) {
      return (
        <text x={x - 6} y={y} textAnchor="end" {...AXIS_STYLE} fontSize={11}>
          <tspan x={x - 6} dy={l2 ? -3 : 4}>
            {l1}
          </tspan>
          {l2 && (
            <tspan x={x - 6} dy={13}>
              {l2}
            </tspan>
          )}
        </text>
      );
    }
    return (
      <text x={x} y={y + 4} textAnchor="middle" {...AXIS_STYLE} fontSize={11.5}>
        <tspan x={x} dy={10}>
          {l1}
        </tspan>
        {l2 && (
          <tspan x={x} dy={14}>
            {l2}
          </tspan>
        )}
      </text>
    );
  };

  const conectores = dados.slice(0, -1).map((d, i) => {
    const prox = dados[i + 1];
    return estreito ? (
      <ReferenceLine
        key={d.chave}
        segment={[
          { x: d.nivel, y: d.chave },
          { x: d.nivel, y: prox.chave },
        ]}
        stroke="#788fa6"
        strokeDasharray="3 3"
        ifOverflow="hidden"
      />
    ) : (
      <ReferenceLine
        key={d.chave}
        segment={[
          { x: d.chave, y: d.nivel },
          { x: prox.chave, y: d.nivel },
        ]}
        stroke="#788fa6"
        strokeDasharray="3 3"
        ifOverflow="hidden"
      />
    );
  });

  const tooltip = (
    <Tooltip
      cursor={{ fill: "#0070f2", fillOpacity: 0.05 }}
      content={({ active, payload }) => {
        const d = active && payload?.[0] ? (payload[0].payload as Degrau) : null;
        if (!d) return null;
        return (
          <div style={tooltipStyle} className="bg-white px-3 py-2 shadow-fiori">
            <div className="font-bold text-text">{d.rotulo}</div>
            <div className="tabular text-text mt-0.5">
              {d.tipo === "saldo" ? fmtBRL(d.valor) : comSinal(d.valor, (x) => fmtBRL(x))}
            </div>
            {d.tipo !== "saldo" && <div className="text-label tabular">Saldo após a etapa: {fmtBRL(d.nivel * 1e6)}</div>}
          </div>
        );
      }}
    />
  );

  const barra = (
    <Bar dataKey="faixa" isAnimationActive={false} radius={estreito ? [0, 3, 3, 0] : [3, 3, 0, 0]} minPointSize={1}>
      {dados.map((d) => (
        <Cell key={d.chave} fill={corDegrau(d)} />
      ))}
      <LabelList dataKey="faixa" content={rotulo} />
    </Bar>
  );

  if (estreito) {
    return (
      <div className="-ml-1" style={{ height: dados.length * 42 + 40 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} layout="vertical" barCategoryGap="22%" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke="#e5e5e5" />
            <XAxis
              type="number"
              domain={[lo, hi]}
              ticks={ticks}
              allowDataOverflow
              tickFormatter={(v: number) => fmtDec(v, ticks.some((x) => !Number.isInteger(x)) ? 1 : 0)}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: "#a8b2bd" }}
            />
            <YAxis type="category" dataKey="chave" tick={tickCategoria} tickLine={false} axisLine={false} width={92} interval={0} />
            {conectores}
            {tooltip}
            {barra}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="h-80 xl:h-auto xl:flex-1 xl:min-h-[340px] -ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} barCategoryGap="22%" margin={{ top: 22, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="#e5e5e5" />
          <XAxis dataKey="chave" tick={tickCategoria} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} height={42} />
          <YAxis
            domain={[lo, hi]}
            ticks={ticks}
            allowDataOverflow
            tickFormatter={(v: number) => fmtDec(v, ticks.some((x) => !Number.isInteger(x)) ? 1 : 0)}
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          {conectores}
          {tooltip}
          {barra}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function C01Movimentacao() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const [periodo, setPeriodo] = useState<Periodo>("exercicio");
  const [visao, setVisao] = useState<Visao>("modalidade");
  const { premissas: p, contratos, posicoes } = useDivida(escopo);
  const estreito = !useMediaQuery("(min-width: 768px)");

  const per = periodoApuracao(periodo, p.dataBase);
  const { inicio, fim } = per;

  const d = useMemo(() => {
    const mov = movimentacaoDivida(contratos, inicio, fim, p);
    const linhas = [...mov.linhas].sort(ordemContrato);
    const t = mov.total;
    const grupos = ORDEM_GRUPOS.map((g) => {
      const ls = linhas.filter((l) => grupoDe(l.c) === g);
      return { grupo: g, linhas: ls, t: somar(ls) };
    }).filter((g) => g.linhas.length > 0);
    const diferenca = diferencaRollforward(t);
    const carteira = totalDivida(posicoes);
    const novas = linhas.filter((l) => l.captacoes > 0);
    const liquidados = linhas.filter((l) => l.saldoInicial > 0 && Math.abs(l.saldoFinal) < 1);
    const capitalizados = linhas.filter((l) => l.capitalizados > 0);
    const dfc = reconciliar(linhas, t);
    const mil = movimentacaoMil(grupos, linhas, t);
    return {
      linhas,
      t,
      grupos,
      diferenca,
      carteira,
      novas,
      liquidados,
      capitalizados,
      eventos: eventosDoPeriodo(linhas, inicio, fim),
      dfc,
      mil,
      dfcMil: reconciliarMil(dfc, mil.total),
    };
  }, [contratos, inicio, fim, p, posicoes]);

  const { t } = d;
  const fechado = Math.abs(d.diferenca) <= TOLERANCIA;
  const bateCarteira = Math.abs(t.saldoFinal - d.carteira) <= TOLERANCIA;
  const variacao = t.saldoFinal - t.saldoInicial;
  const encargos = t.juros + t.atualizacaoMonetaria + t.apropriacaoCustos;
  const escopoLabel = ESCOPOS.find((e) => e.value === escopo)?.label ?? "";
  const periodoTexto = per.rotulo;
  const ativoCPC20 = d.capitalizados
    .map((l) => `${l.c.id} (${l.c.capitalizacaoCPC20?.ativo.toLowerCase()}, até ${fmtDate(l.c.capitalizacaoCPC20?.ate)})`)
    .join("; ");

  // -------------------------------------------------------------------------
  // Exportação
  // -------------------------------------------------------------------------

  /** Linhas da reconciliação com a DFC: em R$ (Excel) ou em R$ mil arredondados que fecham (tela) */
  const linhasDFC = (r: Reconciliacao, saldoInicial: number): LinhaReconciliacao[] => [
    { rotulo: `Saldo em ${fmtDate(inicio)}`, valor: saldoInicial, tipo: "saldo" },
    { rotulo: "Variações com efeito caixa – atividades de financiamento", valor: null, tipo: "secao" },
    { rotulo: "Captações, líquidas dos custos de transação", valor: r.captacoesLiquidas, tipo: "item" },
    { rotulo: "Pagamento de principal", valor: r.principalPago, tipo: "item" },
    { rotulo: "Pagamento de juros", valor: r.jurosPagos, tipo: "item", nota: "¹" },
    { rotulo: "Fluxo de caixa das atividades de financiamento", valor: r.caixa, tipo: "subtotal" },
    { rotulo: "Variações sem efeito caixa", valor: null, tipo: "secao" },
    { rotulo: "Juros apropriados (ao resultado)", valor: r.jurosResultado, tipo: "item" },
    { rotulo: "Atualização monetária (ao resultado)", valor: r.atualizacaoResultado, tipo: "item" },
    { rotulo: "Apropriação de custos (ao resultado)", valor: r.custosResultado, tipo: "item" },
    { rotulo: "Encargos capitalizados no ativo qualificável (CPC 20)", valor: r.capitalizados, tipo: "item", nota: "²" },
    { rotulo: "Total sem efeito caixa (encargos apropriados)", valor: r.naoCaixa, tipo: "subtotal" },
    { rotulo: "Variação do saldo no período", valor: r.variacao, tipo: "total" },
    { rotulo: `Saldo em ${fmtDate(fim)}`, valor: saldoInicial + r.variacao, tipo: "saldo" },
  ];

  const notaPolitica =
    "Política contábil: juros pagos classificados nas atividades de financiamento da DFC (CPC 03, item 33); custos de transação pagos apresentados líquidos das captações.";
  const notaCPC20 = d.capitalizados.length
    ? `Encargos (juros, atualização monetária e apropriação de custos) capitalizados no ativo qualificável: ${ativoCPC20}. Não transitam pelo resultado – são adicionados ao imobilizado em andamento.`
    : "Não houve capitalização de encargos em ativo qualificável no período.";

  const exportar = () => {
    const colunasGrupo = d.grupos.map((g) => ({ titulo: g.grupo, tipo: "moeda" as const, largura: 18 }));
    exportarExcel(
      `C01_Movimentacao_Divida_${inicio}_${fim}.xlsx`,
      [
        {
          nome: "Por modalidade",
          titulo: "C01 – Movimentação da dívida por modalidade",
          subtitulo: `${escopoLabel} · ${per.descricao}: ${per.rotulo} · R$`,
          colunas: [{ titulo: "Movimentação", largura: 58 }, ...colunasGrupo, { titulo: "Total", tipo: "moeda", largura: 20 }],
          linhas: [
            ...ETAPAS.flatMap((e) => {
              const linha = [e.rotulo(inicio, fim), ...d.grupos.map((g) => g.t[e.campo]), t[e.campo]];
              if (e.campo !== "apropriacaoCustos") return [linha];
              const enc = (x: Totais) => x.juros + x.atualizacaoMonetaria + x.apropriacaoCustos;
              return [
                linha,
                [`${LINHA_ENCARGOS} (${DESC_ENCARGOS})`, ...d.grupos.map((g) => enc(g.t)), enc(t)],
                [`   ${LINHA_CPC20}`, ...d.grupos.map((g) => g.t.capitalizados), t.capitalizados],
              ];
            }),
          ],
          notas: [
            `A linha "${LINHA_ENCARGOS}" é um subtotal informativo das três linhas anteriores (não entra na soma do saldo).`,
            `Conciliação da movimentação: diferença de ${fmtBRL(d.diferenca, true)} (${fechado ? "conciliada" : "não conciliada"}).`,
            `Saldo final × carteira C00 na data-base: ${fmtBRL(d.carteira, true)} (${bateCarteira ? "confere" : "diverge"}).`,
            notaCPC20,
          ],
        },
        {
          nome: "Por contrato",
          titulo: "C01 – Movimentação da dívida por contrato",
          subtitulo: `${escopoLabel} · ${per.rotulo} · R$`,
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Transação SAP", largura: 14 },
            { titulo: "Empresa", largura: 10 },
            { titulo: "Modalidade", largura: 20 },
            { titulo: "Instrumento", largura: 52 },
            ...ETAPAS.map((e) => ({ titulo: e.curto, tipo: "moeda" as const, largura: 18 })),
            { titulo: "Encargos apropriados (informativo)", tipo: "moeda", largura: 22 },
            { titulo: "dos quais capitalizados (CPC 20)", tipo: "moeda", largura: 22 },
          ],
          linhas: d.linhas.map((l) => [
            l.c.id,
            l.c.transacao,
            l.c.empresa,
            l.c.modalidade,
            l.c.instrumento,
            ...ETAPAS.map((e) => l[e.campo]),
            l.juros + l.atualizacaoMonetaria + l.apropriacaoCustos,
            l.capitalizados,
          ]),
          total: ["Total", "", "", "", "", ...ETAPAS.map((e) => t[e.campo]), encargos, t.capitalizados],
        },
        {
          nome: "Reconciliação DFC",
          titulo: "Reconciliação com a DFC (CPC 03, item 44A)",
          subtitulo: `Variações dos passivos de financiamento – ${escopoLabel} · ${per.rotulo} · R$`,
          colunas: [
            { titulo: "Variação", largura: 58 },
            { titulo: "Valor (R$)", tipo: "moeda", largura: 20 },
          ],
          linhas: linhasDFC(d.dfc, t.saldoInicial).map((l) => [`${l.tipo === "item" ? "   " : ""}${l.rotulo}${l.nota ?? ""}`, l.valor]),
          notas: [`¹ ${notaPolitica}`, `² ${notaCPC20}`],
        },
      ],
      p.dataBase,
    );
  };

  // -------------------------------------------------------------------------
  // Colunas da visão por contrato
  // -------------------------------------------------------------------------

  const colunasContrato: Column<MovContrato>[] = [
    {
      key: "contrato",
      header: "Contrato",
      sticky: true,
      minWidth: 170,
      value: (l) => l.c.id,
      render: (l) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-text">{l.c.id}</span>
            {l.captacoes > 0 && <Tag color="#0070f2">Nova</Tag>}
            {l.saldoInicial > 0 && Math.abs(l.saldoFinal) < 1 && <Tag>Liquidado</Tag>}
          </div>
          <div className="text-xs text-label whitespace-nowrap">
            {l.c.modalidade} · {l.c.empresa}
          </div>
        </div>
      ),
      total: () => `Total (${d.linhas.length} contratos)`,
    },
    ...ETAPAS.map<Column<MovContrato>>((e) => ({
      key: e.campo,
      header: e.cab,
      headerTitle: e.rotulo(inicio, fim).replace(/^\([+−]\) /, ""),
      align: "right",
      minWidth: e.saldo ? 104 : 92,
      value: (l) => l[e.campo],
      render: (l) => <span className={e.saldo ? "font-semibold" : undefined}>{fmtMil(l[e.campo])}</span>,
      total: () => fmtMil(t[e.campo]),
    })),
    {
      key: "capitalizados",
      header: "Capitalizados",
      headerTitle: LINHA_CPC20,
      align: "right",
      minWidth: 104,
      value: (l) => l.capitalizados,
      render: (l) => <span className="italic text-label">{fmtMil(l.capitalizados)}</span>,
      total: () => <span className="italic">{fmtMil(t.capitalizados)}</span>,
    },
  ];

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi
            label={`Saldo em ${fmtDate(fim)}`}
            value={fmtCompact(t.saldoFinal)}
            sub={`${comSinal(variacao, fmtCompact)} (${comSinal(t.saldoInicial ? variacao / t.saldoInicial : 0, (x) => fmtPct(x, 1))}) no período`}
          />
          <HeaderKpi
            label="Captações líquidas"
            value={fmtCompact(d.dfc.captacoesLiquidas)}
            state={d.dfc.captacoesLiquidas > 0 ? "information" : "neutral"}
            sub={
              d.novas.length
                ? `${d.novas.length > 2 ? `${d.novas.length} contratos` : d.novas.map((l) => l.c.id).join(", ")} · custos ${fmtCompact(-t.custosTransacao)}`
                : "Nenhuma captação no período"
            }
          />
          <HeaderKpi
            label="Encargos apropriados"
            value={fmtCompact(encargos)}
            sub={t.capitalizados >= 1 ? `dos quais ${fmtCompact(t.capitalizados)} capitalizados (CPC 20)` : "juros, atualização e custos"}
          />
          <HeaderKpi
            label="Pagamentos"
            value={fmtCompact(-(t.pagamentoPrincipal + t.pagamentoJuros))}
            sub={`principal ${fmtCompact(-t.pagamentoPrincipal)} · juros ${fmtCompact(-t.pagamentoJuros)}`}
          />
        </>
      }
    >
      {/* Barra de filtros */}
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3 lg:gap-6">
          <FilterField label="Empresa" className="lg:w-72 shrink-0">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} ariaLabel="Empresa" />
          </FilterField>
          <Campo rotulo="Período">
            <SegmentedButton value={periodo} onChange={setPeriodo} items={PERIODOS} />
          </Campo>
          <Campo rotulo="Visão">
            <SegmentedButton
              value={visao}
              onChange={setVisao}
              items={[
                { value: "modalidade", label: "Por modalidade" },
                { value: "contrato", label: "Por contrato" },
              ]}
            />
          </Campo>
          <div className="min-w-0 lg:ml-auto lg:text-right">
            <div className="text-[13px] text-label">Período de apuração</div>
            <div className="text-sm font-semibold text-text tabular mt-0.5">{periodoTexto}</div>
            <div className="text-xs text-label">
              {descricaoPeriodo(periodo, fim)} · {dias} dias
            </div>
          </div>
        </div>
      </div>

      {/* Roll-forward */}
      <Card
        title={visao === "modalidade" ? "Movimentação da dívida por modalidade" : "Movimentação da dívida por contrato"}
        subtitle={
          visao === "modalidade"
            ? `Roll-forward pelo custo amortizado · ${periodoTexto} · R$ mil`
            : `Roll-forward pelo custo amortizado · ${periodoTexto} · R$ mil · a coluna Capitalizados (CPC 20) é informativa`
        }
        status={
          <span className="hidden sm:inline-flex">
            <ObjectStatus state={fechado ? "positive" : "negative"} inverted>
              {fechado ? "Roll-forward fechado" : "Roll-forward não fecha"}
            </ObjectStatus>
          </span>
        }
        bodyClassName="px-0 pb-0"
      >
        {visao === "modalidade" ? (
          <TabelaModalidade grupos={d.grupos} t={t} inicio={inicio} fim={fim} estreito={estreito} />
        ) : (
          <DataTable columns={colunasContrato} rows={d.linhas} rowKey={(l) => l.c.id} showTotals />
        )}

        <div className="border-t border-line-soft px-4 py-3 flex flex-col md:flex-row md:flex-wrap md:items-center gap-x-8 gap-y-2 text-[13px]">
          <Checagem ok={fechado} titulo={fechado ? "Roll-forward fechado" : "Roll-forward não fecha"}>
            saldo inicial + movimentações − saldo final = {fmtBRL(Math.abs(d.diferenca) < 0.005 ? 0 : d.diferenca, true)}
          </Checagem>
          <Checagem ok={bateCarteira} titulo={bateCarteira ? "Saldo final confere com a carteira" : "Saldo final diverge da carteira"}>
            <Link to="/c00-carteira" className="text-link hover:underline">
              C00
            </Link>{" "}
            em {fmtDate(fim)}: {fmtBRL(d.carteira)}
          </Checagem>
        </div>
        {d.capitalizados.length > 0 && (
          <p className="border-t border-line-soft px-4 py-2.5 text-xs text-label leading-relaxed">
            <span className="italic">{LINHA_CPC20}</span>: parcela dos encargos (juros, atualização monetária e apropriação de custos)
            capitalizada em ativo qualificável – {ativoCPC20}. É informativa: já está contida nas linhas de encargos e não altera o
            saldo da dívida; a despesa financeira do período está em{" "}
            <Link to="/c03-encargos" className="text-link hover:underline">
              C03
            </Link>
            .
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card
          className="xl:col-span-3 flex flex-col min-w-0"
          bodyClassName="flex-1 flex flex-col"
          title="Do saldo inicial ao saldo final"
          subtitle={`R$ milhões · ${periodoTexto} · eixo truncado para destacar as movimentações`}
        >
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-label mb-2">
            <Legenda cor={COR_SALDO}>Saldo</Legenda>
            <Legenda cor={COR_AUMENTO}>Aumenta a dívida</Legenda>
            <Legenda cor={COR_REDUCAO}>Reduz a dívida</Legenda>
          </div>
          <Waterfall t={t} estreito={estreito} />
          <div className="mt-4 pt-3 border-t border-line-soft">
            <div className="text-[13px] font-bold text-text mb-1">
              Captações, liquidações e amortizações de principal <span className="text-label font-normal">({d.eventos.length})</span>
            </div>
            {d.eventos.length === 0 ? (
              <p className="text-sm text-label">Nenhuma captação, liquidação ou amortização de principal no período.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {d.eventos.map((ev) => (
                  <li key={ev.chave} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Tag color={COR_EVENTO[ev.tipo]}>{ev.tipo}</Tag>
                        <span className="font-semibold text-text whitespace-nowrap">{ev.c.id}</span>
                        <span className="text-label truncate hidden sm:inline">· {ev.c.instrumento}</span>
                      </div>
                      <div className="text-xs text-label mt-0.5">
                        {fmtDate(ev.data)} · {ev.detalhe}
                      </div>
                    </div>
                    <span className="tabular font-semibold text-text whitespace-nowrap">{comSinal(ev.valor, fmtCompact)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card
          className="xl:col-span-2 min-w-0"
          title="Reconciliação com a DFC (CPC 03, item 44A)"
          subtitle="Variações dos passivos de financiamento: com e sem efeito caixa · R$ mil"
          bodyClassName="px-0 pb-0"
        >
          <div className="grid grid-cols-2 gap-3 px-4 mb-3">
            <Mini rotulo="Com efeito caixa" valor={comSinal(d.dfc.caixa, fmtCompact)} sub="financiamento" />
            <Mini rotulo="Sem efeito caixa" valor={comSinal(d.dfc.naoCaixa, fmtCompact)} sub="encargos" />
          </div>
          <table className="w-full text-sm">
            <tbody>
              {linhasDFC.map((l) => (
                <LinhaDFC key={l.rotulo} {...l} />
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-line-soft space-y-2">
            <Checagem ok={Math.abs(d.dfc.variacao - variacao) <= TOLERANCIA} titulo="Soma = variação do saldo">
              {fmtBRL(t.saldoFinal)} − {fmtBRL(t.saldoInicial)} = {comSinal(variacao, fmtBRL)}
            </Checagem>
            <p className="text-xs text-label leading-relaxed">¹ {notaPolitica}</p>
            <p className="text-xs text-label leading-relaxed">² {notaCPC20}</p>
          </div>
        </Card>
      </div>

      <MessageStrip design="information">
        Movimentação de {periodoTexto} ({escopoLabel.replace(/ \(.*\)$/, "")}) calculada pelo custo amortizado (CDI e spread de títulos em{" "}
        {p.baseDiasUteis} dias úteis; BNDES e correção monetária em {p.baseDiasCorridos} dias corridos), com as premissas
        importadas do SAP: séries históricas de CDI, IPCA e TJLP até a data-base. O período termina na data-base, portanto não há parcelas projetadas nesta tela
        – pagamentos futuros estão em{" "}
        <Link to="/c02-cronograma" className="text-link hover:underline">
          C02
        </Link>
        . O pagamento de principal de contratos IPCA/TLP inclui a atualização monetária da parcela amortizada.
      </MessageStrip>
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Componentes locais
// ---------------------------------------------------------------------------

function TabelaModalidade({
  grupos,
  total,
  inicio,
  fim,
  estreito,
}: {
  /** valores inteiros em R$ mil (arredondamento controlado: linhas e colunas fecham) */
  grupos: { grupo: string; n: number; v: Mil }[];
  total: Mil;
  inicio: string;
  fim: string;
  /** telas estreitas: coluna Total logo após o rótulo (visível sem rolar) e rótulos quebrando linha */
  estreito: boolean;
}) {
  interface Coluna {
    chave: string;
    titulo: string;
    sub?: string;
    total?: boolean;
    v: Mil;
  }
  const colGrupos: Coluna[] = grupos.map((g) => ({
    chave: g.grupo,
    titulo: g.grupo,
    sub: `${g.n} contrato${g.n === 1 ? "" : "s"}`,
    v: g.v,
  }));
  const colTotal: Coluna = { chave: "total", titulo: "Total", sub: estreito ? "R$ mil" : undefined, total: true, v: total };
  const colunas = estreito ? [colTotal, ...colGrupos] : [...colGrupos, colTotal];
  const larguraRotulo = estreito ? 148 : 400;
  const celula = (c: Coluna, i: number, destaque = true) =>
    clsx("text-right tabular px-3 whitespace-nowrap", c.total && destaque && "font-semibold", i === colunas.length - 1 && "pr-4");
  const rotuloCls = "sticky left-0 z-[1] pr-3 text-left shadow-[inset_-1px_0_0_#e5e5e5] md:shadow-none";
  /** linhas informativas (subtotal dos encargos e parcela capitalizada) */
  const memo = "border-b border-line-soft";
  const fundoMemo = (c?: Coluna) => (c?.total ? "bg-[#eef0f2]" : "bg-[#fafbfc]");
  return (
    <div className="overflow-x-auto fiori-scroll">
      <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: larguraRotulo + colunas.length * (estreito ? 100 : 112) }}>
        <thead>
          <tr className="text-[13px]">
            <th className={clsx(rotuloCls, "pl-4 bg-white font-semibold py-2.5 border-b border-[#a8b2bd]")} style={estreito ? { width: larguraRotulo, minWidth: larguraRotulo } : { minWidth: larguraRotulo }}>
              {estreito ? "Movimentação" : "R$ mil"}
            </th>
            {colunas.map((c, i) => (
              <th key={c.chave} className={clsx(celula(c, i), "font-semibold py-2 border-b border-[#a8b2bd]", c.total && "font-bold bg-[#f5f6f7]")}>
                <div>{c.titulo}</div>
                {c.sub && <div className="text-xs font-normal text-label">{c.sub}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ETAPAS.map((e) => {
            const forte = !!e.saldo;
            const borda = forte ? "border-y border-[#a8b2bd]" : "border-b border-line-soft";
            const py = forte ? "py-2.5" : "py-2";
            return [
              <tr key={e.campo} className={forte ? "font-bold" : undefined}>
                <td className={clsx(rotuloCls, "pl-4", py, borda, forte ? "bg-[#f5f6f7]" : "bg-white")}>{e.rotulo(inicio, fim)}</td>
                {colunas.map((c, i) => (
                  <td key={c.chave} className={clsx(celula(c, i), py, borda, (forte || c.total) && "bg-[#f5f6f7]", forte && "font-bold")}>
                    {fmtK(c.v[e.campo])}
                  </td>
                ))}
              </tr>,
              // Subtotal informativo dos encargos (não entra na soma) e parcela capitalizada (CPC 20)
              e.campo === "apropriacaoCustos" && (
                <tr key="encargos" className="font-semibold" title={`${LINHA_ENCARGOS}: ${DESC_ENCARGOS}`}>
                  <td className={clsx(rotuloCls, memo, fundoMemo(), "pl-4 py-2 leading-snug")}>
                    {LINHA_ENCARGOS}
                    <span className="hidden md:inline text-xs font-normal text-label"> · {DESC_ENCARGOS}</span>
                  </td>
                  {colunas.map((c, i) => (
                    <td key={c.chave} className={clsx(celula(c, i), memo, fundoMemo(c), "py-2")}>
                      {fmtK(c.v.encargos)}
                    </td>
                  ))}
                </tr>
              ),
              e.campo === "apropriacaoCustos" && (
                <tr key="cpc20" className="text-label italic">
                  <td className={clsx(rotuloCls, memo, fundoMemo(), "pl-8 py-2 text-[13px] leading-snug")}>{LINHA_CPC20}</td>
                  {colunas.map((c, i) => (
                    <td key={c.chave} className={clsx(celula(c, i, false), memo, fundoMemo(c), "py-2 text-[13px]")}>
                      {fmtK(c.v.capitalizados)}
                    </td>
                  ))}
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

interface LinhaReconciliacao {
  rotulo: string;
  valor: number | null;
  tipo: "saldo" | "secao" | "item" | "subtotal" | "total";
  nota?: string;
}

/** Linha da reconciliação na tela (valor já em R$ mil arredondado) */
function LinhaDFC({ rotulo, valor, tipo, nota }: LinhaReconciliacao) {
  if (tipo === "secao") {
    return (
      <tr>
        <td colSpan={2} className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-label">
          {rotulo}
        </td>
      </tr>
    );
  }
  const forte = tipo === "saldo" || tipo === "total";
  return (
    <tr
      className={clsx(
        forte && "font-bold bg-[#f5f6f7]",
        tipo === "subtotal" && "font-semibold",
      )}
    >
      <td
        className={clsx(
          "pr-3 py-2",
          tipo === "item" ? "pl-7" : "pl-4",
          forte ? "border-y border-[#a8b2bd]" : tipo === "subtotal" ? "border-t border-[#a8b2bd] border-b border-line-soft" : "border-b border-line-soft",
        )}
      >
        {rotulo}
        {nota && <sup className="text-label ml-0.5">{nota}</sup>}
      </td>
      <td
        className={clsx(
          "text-right tabular pl-3 pr-4 py-2 whitespace-nowrap",
          forte ? "border-y border-[#a8b2bd]" : tipo === "subtotal" ? "border-t border-[#a8b2bd] border-b border-line-soft" : "border-b border-line-soft",
        )}
      >
        {valor === null ? "" : fmtK(valor)}
      </td>
    </tr>
  );
}

/** Rótulo + controle sem <label> (evita acionar o primeiro botão do SegmentedButton ao clicar no rótulo) */
function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0" role="group" aria-label={rotulo}>
      <span className="text-[13px] text-label">{rotulo}</span>
      <div className="overflow-x-auto fiori-scroll">{children}</div>
    </div>
  );
}

function Checagem({ ok, titulo, children }: { ok: boolean; titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
      <ObjectStatus state={ok ? "positive" : "negative"}>{titulo}</ObjectStatus>
      <span className="text-label tabular">{children}</span>
    </div>
  );
}

function Mini({ rotulo, valor, sub }: { rotulo: string; valor: ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg bg-[#f5f6f7] px-3 py-2 min-w-0">
      <div className="text-xs text-label leading-tight">{rotulo}</div>
      <div className="text-base sm:text-lg font-bold tabular text-text whitespace-nowrap mt-0.5">{valor}</div>
      {sub && <div className="text-xs text-label leading-tight truncate">{sub}</div>}
    </div>
  );
}

function Legenda({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: cor }} />
      {children}
    </span>
  );
}
