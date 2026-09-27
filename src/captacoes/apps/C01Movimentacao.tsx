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
  addMonths,
  diffDays,
  endOfMonth,
  fmtDate,
  fmtMonthLong,
  fmtMonthShort,
  fmtQuarter,
  monthOf,
  previousMonthEnd,
  previousYearEnd,
  yearOf,
} from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtMil, fmtPct } from "../../shared/lib/format";
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
// Período
// ---------------------------------------------------------------------------

type Periodo = "mes" | "trimestre" | "exercicio" | "12m";
type Visao = "modalidade" | "contrato";

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "mes", label: "Mês" },
  { value: "trimestre", label: "Trimestre" },
  { value: "exercicio", label: "Exercício" },
  { value: "12m", label: "12 meses" },
];

function fimDoMes(iso: string): string {
  return endOfMonth(yearOf(iso), monthOf(iso));
}

function inicioDoPeriodo(periodo: Periodo, dataBase: string): string {
  switch (periodo) {
    case "mes":
      return previousMonthEnd(dataBase);
    case "trimestre":
      return fimDoMes(addMonths(dataBase, -3));
    case "exercicio":
      return previousYearEnd(dataBase);
    case "12m":
      return fimDoMes(addMonths(dataBase, -12));
  }
}

function descricaoPeriodo(periodo: Periodo, dataBase: string): string {
  switch (periodo) {
    case "mes":
      return fmtMonthLong(dataBase);
    case "trimestre":
      return monthOf(dataBase) % 3 === 0 ? `${fmtQuarter(dataBase)} (trimestre civil)` : `3 meses até ${fmtMonthShort(dataBase)}`;
    case "exercicio":
      return monthOf(dataBase) === 12 ? `Exercício ${yearOf(dataBase)}` : `Exercício ${yearOf(dataBase)} até ${fmtMonthShort(dataBase)}`;
    case "12m":
      return `12 meses até ${fmtMonthShort(dataBase)}`;
  }
}

// ---------------------------------------------------------------------------
// Etapas do roll-forward
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

const LINHA_CPC20 = "dos quais juros capitalizados em ativo qualificável (CPC 20)";

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

  const textoRotulo = (d: Degrau) => {
    const v = d.valor / 1e6;
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

  const fim = p.dataBase;
  const inicio = inicioDoPeriodo(periodo, fim);
  const dias = diffDays(inicio, fim);

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
    return { linhas, t, grupos, diferenca, carteira, novas, liquidados, capitalizados, eventos: eventosDoPeriodo(linhas, inicio, fim), dfc: reconciliar(linhas, t) };
  }, [contratos, inicio, fim, p, posicoes]);

  const { t } = d;
  const fechado = Math.abs(d.diferenca) <= TOLERANCIA;
  const bateCarteira = Math.abs(t.saldoFinal - d.carteira) <= TOLERANCIA;
  const variacao = t.saldoFinal - t.saldoInicial;
  const encargos = t.juros + t.atualizacaoMonetaria + t.apropriacaoCustos;
  const escopoLabel = ESCOPOS.find((e) => e.value === escopo)?.label ?? "";
  const periodoTexto = `${fmtDate(inicio)} a ${fmtDate(fim)}`;
  const ativoCPC20 = d.capitalizados
    .map((l) => `${l.c.id} (${l.c.capitalizacaoCPC20?.ativo.toLowerCase()}, até ${fmtDate(l.c.capitalizacaoCPC20?.ate)})`)
    .join("; ");

  // -------------------------------------------------------------------------
  // Exportação
  // -------------------------------------------------------------------------

  const linhasDFC: { rotulo: string; valor: number | null; tipo: "saldo" | "secao" | "item" | "subtotal" | "total"; nota?: string }[] = [
    { rotulo: `Saldo em ${fmtDate(inicio)}`, valor: t.saldoInicial, tipo: "saldo" },
    { rotulo: "Variações com efeito caixa – atividades de financiamento", valor: null, tipo: "secao" },
    { rotulo: "Captações, líquidas dos custos de transação", valor: d.dfc.captacoesLiquidas, tipo: "item" },
    { rotulo: "Pagamento de principal", valor: d.dfc.principalPago, tipo: "item" },
    { rotulo: "Pagamento de juros", valor: d.dfc.jurosPagos, tipo: "item", nota: "¹" },
    { rotulo: "Fluxo de caixa das atividades de financiamento", valor: d.dfc.caixa, tipo: "subtotal" },
    { rotulo: "Variações sem efeito caixa", valor: null, tipo: "secao" },
    { rotulo: "Juros apropriados ao resultado", valor: d.dfc.jurosResultado, tipo: "item" },
    { rotulo: "Atualização monetária", valor: d.dfc.atualizacaoResultado, tipo: "item" },
    { rotulo: "Apropriação de custos de transação", valor: d.dfc.custosResultado, tipo: "item" },
    { rotulo: "Juros capitalizados em ativo qualificável (CPC 20)", valor: d.dfc.capitalizados, tipo: "item", nota: "²" },
    { rotulo: "Total sem efeito caixa", valor: d.dfc.naoCaixa, tipo: "subtotal" },
    { rotulo: "Variação do saldo no período", valor: d.dfc.variacao, tipo: "total" },
    { rotulo: `Saldo em ${fmtDate(fim)}`, valor: t.saldoInicial + d.dfc.variacao, tipo: "saldo" },
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
          titulo: "C01 – Movimentação da dívida (roll-forward) por modalidade",
          subtitulo: `${escopoLabel} · ${descricaoPeriodo(periodo, fim)}: ${periodoTexto} · R$`,
          colunas: [{ titulo: "Movimentação", largura: 58 }, ...colunasGrupo, { titulo: "Total", tipo: "moeda", largura: 20 }],
          linhas: [
            ...ETAPAS.flatMap((e) => {
              const linha = [e.rotulo(inicio, fim), ...d.grupos.map((g) => g.t[e.campo]), t[e.campo]];
              if (e.campo !== "apropriacaoCustos") return [linha];
              return [linha, [`   ${LINHA_CPC20}`, ...d.grupos.map((g) => g.t.capitalizados), t.capitalizados]];
            }),
          ],
          notas: [
            `Checagem do roll-forward: diferença de ${fmtBRL(d.diferenca, true)} (${fechado ? "fechado" : "não fechado"}).`,
            `Saldo final × carteira C00 na data-base: ${fmtBRL(d.carteira, true)} (${bateCarteira ? "confere" : "diverge"}).`,
            notaCPC20,
          ],
        },
        {
          nome: "Por contrato",
          titulo: "C01 – Movimentação da dívida (roll-forward) por contrato",
          subtitulo: `${escopoLabel} · ${periodoTexto} · R$`,
          colunas: [
            { titulo: "Contrato", largura: 10 },
            { titulo: "Transação SAP", largura: 14 },
            { titulo: "Empresa", largura: 10 },
            { titulo: "Modalidade", largura: 20 },
            { titulo: "Instrumento", largura: 52 },
            ...ETAPAS.map((e) => ({ titulo: e.curto, tipo: "moeda" as const, largura: 18 })),
            { titulo: "Juros capitalizados (CPC 20)", tipo: "moeda", largura: 20 },
          ],
          linhas: d.linhas.map((l) => [l.c.id, l.c.transacao, l.c.empresa, l.c.modalidade, l.c.instrumento, ...ETAPAS.map((e) => l[e.campo]), l.capitalizados]),
          total: ["Total", "", "", "", "", ...ETAPAS.map((e) => t[e.campo]), t.capitalizados],
        },
        {
          nome: "Reconciliação DFC",
          titulo: "Reconciliação com a DFC (CPC 03, item 44A)",
          subtitulo: `Variações dos passivos de financiamento – ${escopoLabel} · ${periodoTexto} · R$`,
          colunas: [
            { titulo: "Variação", largura: 58 },
            { titulo: "Valor (R$)", tipo: "moeda", largura: 20 },
          ],
          linhas: linhasDFC.map((l) => [`${l.tipo === "item" ? "   " : ""}${l.rotulo}${l.nota ?? ""}`, l.valor]),
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
  t,
  inicio,
  fim,
  estreito,
}: {
  grupos: { grupo: string; linhas: MovContrato[]; t: Totais }[];
  t: Totais;
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
    v: (campo: CamposMov) => number;
  }
  const colGrupos: Coluna[] = grupos.map((g) => ({
    chave: g.grupo,
    titulo: g.grupo,
    sub: `${g.linhas.length} contrato${g.linhas.length === 1 ? "" : "s"}`,
    v: (campo) => g.t[campo],
  }));
  const colTotal: Coluna = { chave: "total", titulo: "Total", sub: estreito ? "R$ mil" : undefined, total: true, v: (campo) => t[campo] };
  const colunas = estreito ? [colTotal, ...colGrupos] : [...colGrupos, colTotal];
  const larguraRotulo = estreito ? 148 : 400;
  const celula = (c: Coluna, i: number, destaque = true) =>
    clsx("text-right tabular px-3 whitespace-nowrap", c.total && "bg-[#f5f6f7]", c.total && destaque && "font-semibold", i === colunas.length - 1 && "pr-4");
  const rotuloCls = "sticky left-0 z-[1] pr-3 text-left shadow-[inset_-1px_0_0_#e5e5e5] md:shadow-none";
  return (
    <div className="overflow-x-auto fiori-scroll">
      <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: larguraRotulo + colunas.length * (estreito ? 100 : 112) }}>
        <thead>
          <tr className="text-[13px]">
            <th className={clsx(rotuloCls, "pl-4 bg-white font-semibold py-2.5 border-b border-[#a8b2bd]")} style={estreito ? { width: larguraRotulo, minWidth: larguraRotulo } : { minWidth: larguraRotulo }}>
              {estreito ? "Movimentação" : "R$ mil"}
            </th>
            {colunas.map((c, i) => (
              <th key={c.chave} className={clsx(celula(c, i), "font-semibold py-2 border-b border-[#a8b2bd]", c.total && "font-bold")}>
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
                  <td key={c.chave} className={clsx(celula(c, i), py, borda, forte && "bg-[#f5f6f7] font-bold")}>
                    {fmtMil(c.v(e.campo))}
                  </td>
                ))}
              </tr>,
              e.campo === "apropriacaoCustos" && (
                <tr key="cpc20" className="text-label italic">
                  <td className={clsx(rotuloCls, "bg-white pl-8 py-2 border-b border-line-soft text-[13px] leading-snug")}>{LINHA_CPC20}</td>
                  {colunas.map((c, i) => (
                    <td key={c.chave} className={clsx(celula(c, i, false), "py-2 border-b border-line-soft text-[13px]")}>
                      {fmtMil(c.v("capitalizados"))}
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

function LinhaDFC({ rotulo, valor, tipo, nota }: { rotulo: string; valor: number | null; tipo: "saldo" | "secao" | "item" | "subtotal" | "total"; nota?: string }) {
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
        {valor === null ? "" : fmtMil(valor)}
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
