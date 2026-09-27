import { ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, SegmentedButton, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { ESCOPOS, useCarteira, type Escopo } from "../context/useDados";
import { diffDays, fmtDate, lastMonthEnds, previousYearEnd } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { consolidarRentabilidade, rentabilidade, taxaContratada, type RentabOp } from "../lib/finance";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../../shared/lib/format";
import { useBenchmarks } from "../context/BenchmarkContext";
import { compararCarteira, compararOperacao, corExcesso, SITUACAO_STATE, SITUACAO_TEXTO, type ComparacaoBenchmark } from "../lib/benchmark";
import { consolidarPorTipo, rentabilidadeMestre, TIPOS_CONTRATO, type RentabContrato, type TipoContrato } from "../lib/carteiraMestre";

const rel = relatorioPorId("r03");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

type Periodo = "mes" | "tri" | "ano" | "12m";
const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "mes", label: "Mês" },
  { value: "tri", label: "3 meses" },
  { value: "ano", label: "No ano" },
  { value: "12m", label: "12 meses" },
];

function inicioPeriodo(periodo: Periodo, dataBase: string): string {
  switch (periodo) {
    case "mes":
      return lastMonthEnds(dataBase, 2)[0];
    case "tri":
      return lastMonthEnds(dataBase, 4)[0];
    case "ano":
      return previousYearEnd(dataBase);
    case "12m":
      return lastMonthEnds(dataBase, 13)[0];
  }
}

const pctCDI = (v: number) => `${fmtDec(v * 100, 1)}%`;

type FiltroStatus = "todas" | "Ativa" | "Liquidada";
const ROTULO_STATUS: Record<FiltroStatus, string> = {
  todas: "Todos os contratos",
  Ativa: "Somente ativos",
  Liquidada: "Somente liquidados",
};

/** Critério de cada tipo de contrato no consolidado (subtítulo da linha e nota) */
const CRITERIO_TIPO: Record<TipoContrato, { linha: string; nota: string }> = {
  "Renda fixa bancária": {
    linha: "CDB, LF, LCI/LCA, compromissadas e crédito privado",
    nota: "Rendimento na curva do papel; IOF regressivo até D+30 e IRRF pela tabela regressiva (pessoa jurídica: inclusive LCI/LCA/CRI/CRA; debênture incentivada a 15%) – mesmo motor da tabela por contrato.",
  },
  "Tesouro Direto": {
    linha: "Títulos públicos na curva + cupons",
    nota: "Variação do saldo na curva + cupons e vencimentos pagos no período; IRRF regressivo; taxas = custódia B3 (0,20% a.a.) + agente (0,05% a.a.).",
  },
  "Fundo de investimento": {
    linha: "Cota líquida de taxas + come-cotas",
    nota: "Rendimento pela variação da cota, já líquida das taxas de administração e performance, somado ao come-cotas recolhido (redução de cotas); o IR do período inclui o come-cotas (maio/novembro) e o complemento pela alíquota do prazo.",
  },
  "Time deposit": {
    linha: "Juros + variação cambial (PTAX)",
    nota: "Rendimento em R$ = juros + variação cambial pela PTAX: fica negativo quando o real se aprecia. IOF câmbio de 0,38% e tarifa na remessa; IRPJ/CSLL (34%) estimado, sem retenção na fonte.",
  },
};

interface LinhaTipo {
  chave: TipoContrato | "total";
  rotulo: string;
  curto: string;
  cor: string;
  origem: string;
  rota: string;
  contratos: number;
  /** capital base de cada contrato ponderado pelos dias no período (mesmo critério do consolidado de renda fixa) */
  capital: number;
  rendimento: number;
  iof: number;
  ir: number;
  taxas: number;
  rendLiquido: number;
  rentabBruta: number;
  rentabLiquida: number;
  pctCDIBruto: number;
  pctCDILiquido: number;
  rentabReal: number;
  bmk: ComparacaoBenchmark | null;
}

/** Capital médio, rentabilidade e real de um conjunto de contratos (mesmo método de consolidarRentabilidade) */
function resumir(ls: RentabContrato[], diasPeriodo: number, ipcaPeriodo: number) {
  const soma = (fn: (l: RentabContrato) => number) => ls.reduce((s, l) => s + fn(l), 0);
  const capital = soma((l) => l.base * (l.dias / diasPeriodo));
  const peso = soma((l) => l.base * l.cdiPeriodo);
  const rendimento = soma((l) => l.rendimento);
  const rendLiquido = soma((l) => l.rendLiquido);
  const rentabLiquida = capital > 0 ? rendLiquido / capital : 0;
  return {
    capital,
    rendimento,
    iof: soma((l) => l.iof),
    ir: soma((l) => l.ir),
    taxas: soma((l) => l.taxas),
    rendLiquido,
    rentabBruta: capital > 0 ? rendimento / capital : 0,
    rentabLiquida,
    pctCDIBruto: peso > 0 ? rendimento / peso : 0,
    pctCDILiquido: peso > 0 ? rendLiquido / peso : 0,
    rentabReal: capital > 0 ? (1 + rentabLiquida) / (1 + ipcaPeriodo) - 1 : 0,
  };
}

/** Rótulo do eixo X quebrado em duas linhas */
function TickQuebrado({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const palavras = String(payload?.value ?? "").split(" ");
  const linhas = palavras.length > 1 ? [palavras[0], palavras.slice(1).join(" ")] : palavras;
  return (
    <text x={x} y={y + 12} textAnchor="middle" fontSize={11} fill={AXIS_STYLE.fill} fontFamily={AXIS_STYLE.fontFamily}>
      {linhas.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 13}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

export function R03Rentabilidade() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const [periodo, setPeriodo] = useState<Periodo>("12m");
  const [status, setStatus] = useState<FiltroStatus>("todas");
  const { premissas: p, ops } = useCarteira(escopo);
  const { cadastro } = useBenchmarks();
  const inicio = inicioPeriodo(periodo, p.dataBase);

  const { linhas, cart, bmk, cmp } = useMemo(() => {
    const todas = rentabilidade(ops, inicio, p.dataBase, p);
    const linhas = status === "todas" ? todas : todas.filter((r) => r.status === status);
    return {
      linhas,
      cart: consolidarRentabilidade(linhas, inicio, p.dataBase, p),
      bmk: compararCarteira(linhas, cadastro, p),
      cmp: new Map(linhas.map((r) => [r.op.transacao, compararOperacao(r, cadastro, p)])),
    };
  }, [ops, inicio, p, status, cadastro]);
  const cmpDe = (r: RentabOp) => cmp.get(r.op.transacao)!;

  // Consolidado por tipo de contrato (Carteira-Mestre): renda fixa bancária, Tesouro Direto, fundos e time deposits
  const { tipos, total } = useMemo(() => {
    const todas = rentabilidadeMestre(inicio, p.dataBase, p, escopo);
    const ls = status === "todas" ? todas : todas.filter((l) => l.status === status);
    const diasPeriodo = Math.max(1, diffDays(inicio, p.dataBase));
    const tipos: LinhaTipo[] = consolidarPorTipo(ls).map((c) => {
      const doTipo = ls.filter((l) => l.tipo === c.tipo);
      const r = resumir(doTipo, diasPeriodo, cart.ipcaPeriodo);
      return {
        ...r,
        chave: c.tipo,
        rotulo: c.tipo,
        curto: c.curto,
        cor: c.cor,
        origem: c.origem,
        rota: c.rota,
        contratos: c.contratos,
        // totais e % do CDI do motor (consolidarPorTipo)
        rendimento: c.rendimento,
        iof: c.iof,
        ir: c.ir,
        taxas: c.taxas,
        rendLiquido: c.rendLiquido,
        pctCDIBruto: c.pctCDIBruto,
        pctCDILiquido: c.pctCDILiquido,
        bmk: doTipo.length ? compararCarteira(doTipo, cadastro, p) : null,
      };
    });
    const total: LinhaTipo = {
      ...resumir(ls, diasPeriodo, cart.ipcaPeriodo),
      chave: "total",
      rotulo: "Carteira consolidada",
      curto: "Consolidado",
      cor: "#475e75",
      origem: "",
      rota: "",
      contratos: ls.length,
      bmk: ls.length ? compararCarteira(ls, cadastro, p) : null,
    };
    return { tipos, total };
  }, [inicio, p, escopo, status, cadastro, cart.ipcaPeriodo]);

  const graficoTipos = useMemo(
    () =>
      [...tipos.filter((t) => t.contratos > 0), total].map((t) => ({
        nome: t.curto,
        cor: t.cor,
        bruto: t.pctCDIBruto * 100,
        liquido: t.pctCDILiquido * 100,
        benchmark: t.bmk ? t.bmk.pct * 100 : null,
      })),
    [tipos, total],
  );

  const escalaTipos = useMemo(() => {
    const vals = graficoTipos.flatMap((g) => [g.bruto, g.liquido, g.benchmark ?? 0]);
    const min = Math.min(0, ...vals);
    const max = Math.max(110, ...vals);
    const step = [20, 40, 50, 100, 200].find((st) => (Math.ceil(max / st) - Math.floor(min / st)) <= 6) ?? 500;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    return { lo, hi, ticks: Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step) };
  }, [graficoTipos]);

  const semDados = (t: LinhaTipo, v: string) => (t.contratos > 0 ? v : <span className="text-label">–</span>);
  const colunasTipo: Column<LinhaTipo>[] = [
    {
      key: "tipo",
      header: "Tipo de contrato",
      sticky: true,
      minWidth: 230,
      value: (t) => t.rotulo,
      render: (t) => (
        <div className="flex items-start gap-2.5">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1.5" style={{ backgroundColor: t.cor }} />
          <div className="min-w-0">
            <div className="font-semibold text-text">{t.rotulo}</div>
            <div className="text-xs text-label leading-snug">{t.chave !== "total" && CRITERIO_TIPO[t.chave].linha}</div>
          </div>
        </div>
      ),
      total: () => <span>Carteira consolidada</span>,
    },
    {
      key: "origem",
      header: "Relatório",
      value: (t) => t.origem,
      render: (t) => (
        <Link to={t.rota} className="text-link font-semibold hover:underline inline-flex items-center gap-0.5 whitespace-nowrap">
          {t.chave === "Renda fixa bancária" ? "R01/R03" : t.origem}
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      ),
    },
    { key: "n", header: "Contratos", align: "right", value: (t) => t.contratos, total: () => total.contratos },
    {
      key: "capital",
      header: "Capital médio",
      headerTitle: "Capital base de cada contrato (saldo no início do período ou valor aplicado) ponderado pelos dias no período",
      align: "right",
      value: (t) => t.capital,
      render: (t) => semDados(t, fmtNum(t.capital)),
      total: () => fmtNum(total.capital),
    },
    { key: "rend", header: "Rend. bruto", align: "right", value: (t) => t.rendimento, render: (t) => semDados(t, fmtNum(t.rendimento)), total: () => fmtNum(total.rendimento) },
    { key: "iof", header: "IOF", headerTitle: "IOF regressivo (renda fixa, títulos e fundos) e IOF câmbio na remessa (time deposits)", align: "right", value: (t) => t.iof, render: (t) => (t.iof ? <span className="text-critical">{fmtNum(t.iof)}</span> : <span className="text-label">–</span>), total: () => fmtNum(total.iof, { dash: true }) },
    { key: "ir", header: "IR", headerTitle: "IRRF (renda fixa, títulos e fundos, inclusive come-cotas) e IRPJ/CSLL estimado (time deposits)", align: "right", value: (t) => t.ir, render: (t) => (t.ir ? fmtNum(t.ir) : <span className="text-label">–</span>), total: () => fmtNum(total.ir, { dash: true }) },
    { key: "taxas", header: "Taxas/tarifas", headerTitle: "Custódia B3 e agente (Tesouro Direto) e tarifa bancária (time deposits); fundos já rendem líquidos das taxas", align: "right", value: (t) => t.taxas, render: (t) => (t.taxas ? fmtNum(t.taxas) : <span className="text-label">–</span>), total: () => fmtNum(total.taxas, { dash: true }) },
    {
      key: "liq",
      header: "Rend. líquido",
      align: "right",
      value: (t) => t.rendLiquido,
      render: (t) => semDados(t, fmtNum(t.rendLiquido)),
      total: () => fmtNum(total.rendLiquido),
      className: "font-semibold",
    },
    {
      key: "cdib",
      header: "% CDI bruto",
      align: "right",
      value: (t) => t.pctCDIBruto,
      render: (t) =>
        t.contratos > 0 ? <span className={t.pctCDIBruto >= 1 ? "text-positive font-semibold" : t.pctCDIBruto < 0 ? "text-negative" : ""}>{pctCDI(t.pctCDIBruto)}</span> : <span className="text-label">–</span>,
      total: () => pctCDI(total.pctCDIBruto),
    },
    {
      key: "cdil",
      header: "% CDI líquido",
      align: "right",
      value: (t) => t.pctCDILiquido,
      render: (t) => (t.contratos > 0 ? <span className={t.pctCDILiquido < 0 ? "text-negative" : ""}>{pctCDI(t.pctCDILiquido)}</span> : <span className="text-label">–</span>),
      total: () => pctCDI(total.pctCDILiquido),
    },
    {
      key: "bmk",
      header: "Benchmark",
      headerTitle: "% do CDI do benchmark cadastrado no período, capitalizado dia a dia sobre o mesmo capital base",
      align: "right",
      value: (t) => t.bmk?.pct ?? null,
      render: (t) =>
        t.bmk ? (
          <div className="whitespace-nowrap">
            <div>{pctCDI(t.bmk.pct)}</div>
            <div className={`text-xs ${corExcesso(t.bmk.excesso)}`}>
              {t.bmk.realizado - t.bmk.pct >= 0 ? "+" : ""}
              {fmtDec((t.bmk.realizado - t.bmk.pct) * 100, 1)} p.p.
            </div>
          </div>
        ) : (
          <span className="text-label">–</span>
        ),
      total: () => (total.bmk ? pctCDI(total.bmk.pct) : "–"),
    },
    {
      key: "real",
      header: "Rentab. real",
      headerTitle: "(1 + rentabilidade líquida sobre o capital médio) ÷ (1 + IPCA do período) − 1",
      align: "right",
      value: (t) => t.rentabReal,
      render: (t) => (t.contratos > 0 ? <span className={t.rentabReal >= 0 ? "text-positive" : "text-negative"}>{fmtPct(t.rentabReal)}</span> : <span className="text-label">–</span>),
      total: () => <span className={total.rentabReal >= 0 ? "text-positive" : "text-negative"}>{fmtPct(total.rentabReal)}</span>,
    },
  ];

  const porProduto = useMemo(() => {
    const map = new Map<string, RentabOp[]>();
    for (const r of linhas) map.set(r.op.produto, [...(map.get(r.op.produto) ?? []), r]);
    return [...map.entries()]
      .map(([produto, rs]) => {
        const c = consolidarRentabilidade(rs, inicio, p.dataBase, p);
        const b = compararCarteira(rs, cadastro, p);
        return { produto, bruto: c.pctCDIBruto * 100, liquido: c.pctCDILiquido * 100, benchmark: b.pct * 100 };
      })
      .sort((a, b) => b.bruto - a.bruto);
  }, [linhas, inicio, p, cadastro]);

  const colunas: Column<RentabOp>[] = [
    {
      key: "op",
      header: "Aplicação",
      sticky: true,
      minWidth: 200,
      value: (r) => r.op.contraparte,
      render: (r) => (
        <div>
          <div className="font-semibold text-text">
            {r.op.produto} · {r.op.contraparte}
          </div>
          <div className="text-xs text-label">
            {r.op.transacao} · {taxaContratada(r.op)}
          </div>
        </div>
      ),
      total: () => <span>Carteira ({linhas.length})</span>,
    },
    {
      key: "status",
      header: "Status",
      value: (r) => r.status,
      render: (r) => (
        <div className="leading-snug">
          <ObjectStatus inverted icon={false} state={r.status === "Ativa" ? "positive" : "neutral"}>
            {r.status}
          </ObjectStatus>
          {r.status === "Liquidada" && <div className="text-xs text-label tabular mt-0.5">{fmtDate(r.fim)}</div>}
        </div>
      ),
    },
    { key: "base", header: "Capital base", align: "right", headerTitle: "Saldo no início do período ou valor aplicado, se posterior", value: (r) => r.base, render: (r) => fmtNum(r.base) },
    { key: "rend", header: "Rend. bruto", headerTitle: "Rendimento bruto no período", align: "right", value: (r) => r.rendimento, render: (r) => fmtNum(r.rendimento), total: () => fmtNum(cart.rendimento) },
    { key: "iof", header: "IOF", align: "right", value: (r) => r.iof, render: (r) => (r.iof ? <span className="text-critical">{fmtNum(r.iof)}</span> : <span className="text-label">–</span>), total: () => fmtNum(cart.iof) },
    { key: "ir", header: "IRRF", align: "right", value: (r) => r.ir, render: (r) => fmtNum(r.ir), total: () => fmtNum(cart.ir) },
    { key: "liq", header: "Rend. líquido", headerTitle: "Rendimento líquido de IOF e IRRF", align: "right", value: (r) => r.rendLiquido, render: (r) => <span className="font-semibold">{fmtNum(r.rendLiquido)}</span>, total: () => fmtNum(cart.rendLiquido) },
    { key: "rb", header: "Rentab. bruta", align: "right", value: (r) => r.rentabBruta, render: (r) => fmtPct(r.rentabBruta), total: () => fmtPct(cart.rentabBruta) },
    {
      key: "cdib",
      header: "% CDI bruto",
      align: "right",
      value: (r) => r.pctCDIBruto,
      render: (r) => <span className={r.pctCDIBruto >= 1 ? "text-positive font-semibold" : ""}>{pctCDI(r.pctCDIBruto)}</span>,
      total: () => pctCDI(cart.pctCDIBruto),
    },
    { key: "cdil", header: "% CDI líquido", align: "right", value: (r) => r.pctCDILiquido, render: (r) => pctCDI(r.pctCDILiquido), total: () => pctCDI(cart.pctCDILiquido) },
    {
      key: "real",
      header: "Rentab. real",
      align: "right",
      headerTitle: "Rendimento líquido descontado o IPCA do período",
      value: (r) => r.rentabReal,
      render: (r) => <span className={r.rentabReal >= 0 ? "text-positive" : "text-negative"}>{fmtPct(r.rentabReal)}</span>,
      total: () => fmtPct(cart.rentabReal),
    },
    {
      key: "bmk",
      header: "Benchmark",
      headerTitle:
        "% do CDI do benchmark no período: capital base × (Π (1 + DI diário × % da regra vigente no dia) − 1) ÷ (capital base × CDI do período) – mesma base do % CDI bruto",
      align: "right",
      value: (r) => cmpDe(r).pct,
      render: (r) => {
        const c = cmpDe(r);
        return (
          <div className="whitespace-nowrap" title={c.trechos.length > 1 ? "Regra de benchmark alterada no período" : undefined}>
            <div>{pctCDI(c.pct)}</div>
            <div className="text-xs text-label">
              regra {pctCDI(c.pctRegra)}
              {c.trechos.length > 1 ? "*" : ""}
            </div>
          </div>
        );
      },
      total: () => pctCDI(bmk.pct),
    },
    {
      key: "exc",
      header: "Excesso",
      headerTitle: "Excesso sobre o benchmark: rendimento bruto − rendimento do benchmark sobre o mesmo capital base (capitalizado dia a dia)",
      align: "right",
      value: (r) => cmpDe(r).excesso,
      render: (r) => {
        const c = cmpDe(r);
        return (
          <div className="whitespace-nowrap">
            <div className={corExcesso(c.excesso)}>{fmtNum(c.excesso, { parens: true })}</div>
            <div className="text-xs text-label">
              {c.realizado - c.pct >= 0 ? "+" : ""}
              {fmtDec((c.realizado - c.pct) * 100, 1)} p.p.
            </div>
          </div>
        );
      },
      total: () => <span className={corExcesso(bmk.excesso)}>{fmtNum(bmk.excesso, { parens: true })}</span>,
    },
  ];

  const exportar = () =>
    exportarExcel(
      `R03_Rentabilidade_${p.dataBase}.xlsx`,
      [
        {
          nome: "Consolidado por tipo",
          titulo: "R03 – Rentabilidade consolidada por tipo de contrato (Carteira-Mestre)",
          subtitulo: `${ESCOPOS.find((e) => e.value === escopo)!.label} · ${ROTULO_STATUS[status]} · Período ${fmtDate(inicio)} a ${fmtDate(p.dataBase)}`,
          colunas: [
            { titulo: "Tipo de contrato", largura: 24 },
            { titulo: "Relatório de origem", largura: 12 },
            { titulo: "Contratos", tipo: "inteiro" },
            { titulo: "Capital médio", tipo: "moeda" },
            { titulo: "Rendimento bruto", tipo: "moeda" },
            { titulo: "IOF", tipo: "moeda" },
            { titulo: "IR (IRRF / IRPJ-CSLL)", tipo: "moeda", largura: 16 },
            { titulo: "Taxas/tarifas", tipo: "moeda" },
            { titulo: "Rendimento líquido", tipo: "moeda" },
            { titulo: "Rentab. bruta", tipo: "pct" },
            { titulo: "Rentab. líquida", tipo: "pct" },
            { titulo: "% CDI bruto", tipo: "pct" },
            { titulo: "% CDI líquido", tipo: "pct" },
            { titulo: "Benchmark no período (% CDI)", tipo: "pct", largura: 16 },
            { titulo: "Excesso s/ benchmark", tipo: "moeda" },
            { titulo: "Rentab. real", tipo: "pct" },
          ],
          linhas: tipos.map((t) => [
            t.rotulo,
            t.chave === "Renda fixa bancária" ? "R01/R03" : t.origem,
            t.contratos,
            t.capital,
            t.rendimento,
            t.iof,
            t.ir,
            t.taxas,
            t.rendLiquido,
            t.contratos ? t.rentabBruta : null,
            t.contratos ? t.rentabLiquida : null,
            t.contratos ? t.pctCDIBruto : null,
            t.contratos ? t.pctCDILiquido : null,
            t.bmk?.pct ?? null,
            t.bmk?.excesso ?? null,
            t.contratos ? t.rentabReal : null,
          ]),
          total: [
            "CARTEIRA CONSOLIDADA",
            "",
            total.contratos,
            total.capital,
            total.rendimento,
            total.iof,
            total.ir,
            total.taxas,
            total.rendLiquido,
            total.rentabBruta,
            total.rentabLiquida,
            total.pctCDIBruto,
            total.pctCDILiquido,
            total.bmk?.pct ?? null,
            total.bmk?.excesso ?? null,
            total.rentabReal,
          ],
          notas: [
            `CDI do período: ${fmtPct(cart.cdiPeriodo)} · IPCA do período: ${fmtPct(cart.ipcaPeriodo)} (IPCA 12m das Premissas: ${fmtPct(p.ipca12m)}, projetado com o último dado disponível).`,
            "Capital médio = capital base de cada contrato (saldo no início do período ou valor aplicado) × dias no período ÷ dias do período; % do CDI = rendimento ÷ Σ (capital base × CDI do período do contrato).",
            ...TIPOS_CONTRATO.map((t) => `${t.tipo}: ${CRITERIO_TIPO[t.tipo].nota}`),
            "Rentabilidade real = (1 + rentabilidade líquida) / (1 + IPCA do período) − 1.",
          ],
        },
        {
          nome: "R03 - Rentabilidade",
          titulo: "R03 – Rentabilidade realizada e real por contrato de renda fixa bancária",
          subtitulo: `${ESCOPOS.find((e) => e.value === escopo)!.label} · Período ${fmtDate(inicio)} a ${fmtDate(p.dataBase)}`,
          colunas: [
            { titulo: "Transação", largura: 12 },
            { titulo: "Produto", largura: 16 },
            { titulo: "Parceiro de Negócio", largura: 26 },
            { titulo: "Taxa", largura: 14 },
            { titulo: "Status", largura: 10 },
            { titulo: "Capital base", tipo: "moeda" },
            { titulo: "Rendimento bruto", tipo: "moeda" },
            { titulo: "IOF", tipo: "moeda" },
            { titulo: "IRRF", tipo: "moeda" },
            { titulo: "Rendimento líquido", tipo: "moeda" },
            { titulo: "Rentab. bruta", tipo: "pct" },
            { titulo: "% CDI bruto", tipo: "pct" },
            { titulo: "% CDI líquido", tipo: "pct" },
            { titulo: "Rentab. real", tipo: "pct" },
            { titulo: "Regra de benchmark (% CDI, média do período)", tipo: "pct", largura: 18 },
            { titulo: "Benchmark no período (% CDI)", tipo: "pct", largura: 16 },
            { titulo: "Rendimento do benchmark", tipo: "moeda" },
            { titulo: "Excesso s/ benchmark", tipo: "moeda" },
          ],
          linhas: linhas.map((r) => {
            const c = cmpDe(r);
            return [r.op.transacao, r.op.produto, r.op.contraparte, taxaContratada(r.op), r.status, r.base, r.rendimento, r.iof, r.ir, r.rendLiquido, r.rentabBruta, r.pctCDIBruto, r.pctCDILiquido, r.rentabReal, c.pctRegra, c.pct, c.rendBenchmark, c.excesso];
          }),
          total: ["CARTEIRA", "", "", "", "", "", cart.rendimento, cart.iof, cart.ir, cart.rendLiquido, cart.rentabBruta, cart.pctCDIBruto, cart.pctCDILiquido, cart.rentabReal, bmk.pctRegra, bmk.pct, bmk.rendBenchmark, bmk.excesso],
          notas: [
            `CDI do período: ${fmtPct(cart.cdiPeriodo)} · IPCA do período: ${fmtPct(cart.ipcaPeriodo)} (IPCA 12m das Premissas: ${fmtPct(p.ipca12m)}).`,
            "Rentabilidade real = (1 + rentabilidade líquida) / (1 + IPCA do período) − 1.",
            "Benchmark: rendimento = capital base × (Π (1 + DI diário × % do CDI da regra vigente no dia) − 1), DI diário = (1 + CDI do dia)^(1/252) − 1; benchmark no período (% CDI) = esse rendimento ÷ (capital base × CDI do período); excesso = rendimento bruto − rendimento do benchmark.",
          ],
        },
      ],
      p.dataBase,
    );

  const passos = [
    { rotulo: "Rentabilidade bruta", v: cart.rentabBruta, cor: "#0070f2" },
    { rotulo: "(−) IOF", v: -(cart.iof / Math.max(1, cart.rendimento)) * cart.rentabBruta, cor: "#e76500" },
    { rotulo: "(−) IRRF", v: -(cart.ir / Math.max(1, cart.rendimento)) * cart.rentabBruta, cor: "#e76500" },
    { rotulo: "Rentabilidade líquida", v: cart.rentabLiquida, cor: "#256f3a" },
    { rotulo: "(−) Inflação (IPCA)", v: cart.rentabReal - cart.rentabLiquida, cor: "#aa0808" },
    { rotulo: "Rentabilidade real", v: cart.rentabReal, cor: "#049f9a" },
  ];
  const maxPasso = Math.max(...passos.map((x) => Math.abs(x.v)), 0.0001);

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <div className="flex flex-col sm:flex-row gap-x-8 gap-y-4 min-w-0">
          <GrupoKpi titulo="Consolidado">
            <HeaderKpi
              label="% CDI consolidado"
              value={pctCDI(total.pctCDIBruto)}
              state={total.bmk ? SITUACAO_STATE[total.bmk.situacao] : "neutral"}
              sub={`Líquido ${pctCDI(total.pctCDILiquido)}`}
            />
          </GrupoKpi>
          <GrupoKpi titulo="Renda fixa bancária" divisor>
            <HeaderKpi label="Rendimento bruto" value={fmtCompact(cart.rendimento)} />
            <HeaderKpi label="Rendimento líquido" value={fmtCompact(cart.rendLiquido)} sub={`IR+IOF ${fmtCompact(cart.ir + cart.iof)}`} />
            <HeaderKpi label="% CDI bruto" value={pctCDI(cart.pctCDIBruto)} state={SITUACAO_STATE[bmk.situacao]} sub={`Benchmark ${pctCDI(bmk.pct)}`} />
            <HeaderKpi label="Excesso s/ benchmark" value={fmtCompact(bmk.excesso)} state={bmk.excesso >= 0 ? "positive" : "negative"} sub={SITUACAO_TEXTO[bmk.situacao]} />
            <HeaderKpi label="Rentabilidade real" value={fmtPct(cart.rentabReal)} state={cart.rentabReal >= 0 ? "positive" : "negative"} sub={`IPCA ${fmtPct(cart.ipcaPeriodo)}`} />
          </GrupoKpi>
        </div>
      }
    >
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <FilterField label="Empresa" className="lg:w-80">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
          </FilterField>
          <FilterField label="Status" className="lg:w-56">
            <Select value={status} onChange={setStatus} options={(Object.keys(ROTULO_STATUS) as FiltroStatus[]).map((v) => ({ value: v, label: ROTULO_STATUS[v] }))} />
          </FilterField>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-label">Período</span>
            <SegmentedButton value={periodo} onChange={setPeriodo} items={PERIODOS} />
          </div>
          <div className="lg:ml-auto text-[13px] text-label lg:text-right">
            <div>
              {fmtDate(inicio)} a {fmtDate(p.dataBase)} · CDI do período <strong className="text-text">{fmtPct(cart.cdiPeriodo)}</strong>
            </div>
            <div>
              IPCA do período <strong className="text-text">{fmtPct(cart.ipcaPeriodo)}</strong> (projetado com o IPCA 12m das Premissas)
            </div>
          </div>
        </div>
      </div>

      <Card
        title="Consolidado por tipo de contrato"
        subtitle={`Carteira-Mestre: renda fixa bancária, Tesouro Direto, fundos e time deposits em R$ · ${total.contratos} contratos no período (${status === "todas" ? "inclusive liquidados" : ROTULO_STATUS[status].toLowerCase()}) · benchmark cadastrado capitalizado dia a dia`}
        bodyClassName="px-0 pb-0"
      >
        <DataTable columns={colunasTipo} rows={tipos} rowKey={(t) => t.chave} showTotals />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card className="xl:col-span-3" title="% do CDI por tipo de contrato" subtitle="Bruto × líquido de IOF, IR e taxas no período · traço = benchmark cadastrado">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-text mb-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-[#475e75]" />% CDI bruto (cor cheia)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-[#475e75]/40" />% CDI líquido (cor clara)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-[3px] rounded-full bg-[#1d2d3e]" />
              Benchmark
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-[#788fa6]" />
              100% do CDI
            </span>
          </div>
          <div className="h-72 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={graficoTipos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="nome" tick={<TickQuebrado />} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} height={40} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={44} domain={[escalaTipos.lo, escalaTipos.hi]} ticks={escalaTipos.ticks} tickFormatter={(v: number) => `${fmtDec(v, 0)}%`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${fmtDec(v, 1)}% do CDI`, n]} />
                <ReferenceLine y={0} stroke="#a8b2bd" />
                <ReferenceLine y={100} stroke="#788fa6" strokeDasharray="4 4" />
                <Bar dataKey="bruto" name="% CDI bruto" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {graficoTipos.map((d) => (
                    <Cell key={d.nome} fill={d.cor} />
                  ))}
                </Bar>
                <Bar dataKey="liquido" name="% CDI líquido" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {graficoTipos.map((d) => (
                    <Cell key={d.nome} fill={d.cor} fillOpacity={0.4} />
                  ))}
                </Bar>
                <Line
                  dataKey="benchmark"
                  name="Benchmark"
                  stroke="#1d2d3e"
                  strokeWidth={0}
                  activeDot={false}
                  isAnimationActive={false}
                  dot={(props: { cx?: number; cy?: number; index?: number; value?: number | null }) =>
                    props.value === null || props.value === undefined || props.cy === undefined ? (
                      <g key={props.index} />
                    ) : (
                      <line key={props.index} x1={(props.cx ?? 0) - 18} x2={(props.cx ?? 0) + 18} y1={props.cy} y2={props.cy} stroke="#1d2d3e" strokeWidth={3} strokeLinecap="round" />
                    )
                  }
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="xl:col-span-2" title="Critérios do consolidado" subtitle="Como cada tipo de contrato entra na rentabilidade">
          <ul className="space-y-2.5">
            {TIPOS_CONTRATO.map((t) => (
              <li key={t.tipo} className="flex items-start gap-2.5 text-[13px] leading-snug">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1" style={{ backgroundColor: t.cor }} />
                <span className="text-text">
                  <strong className="font-semibold">{t.tipo}.</strong> <span className="text-label">{CRITERIO_TIPO[t.tipo].nota}</span>
                </span>
              </li>
            ))}
          </ul>
          <MessageStrip className="mt-4">
            % do CDI = rendimento ÷ Σ (capital base × CDI do período de cada contrato); rentabilidade real = (1 + líquida sobre o capital médio) ÷ (1 + IPCA do período) − 1.
          </MessageStrip>
        </Card>
      </div>

      <Card title={`Renda fixa bancária – rentabilidade por contrato (${linhas.length})`} subtitle="Inclui aplicações liquidadas no período (rendimento até a data do resgate) · benchmark capitalizado dia a dia com a regra vigente em cada dia (* regra alterada no período)" bodyClassName="px-0 pb-0">
        <DataTable columns={colunas} rows={linhas} rowKey={(r) => r.op.transacao} showTotals defaultSort={{ key: "rend", dir: "desc" }} maxHeight={560} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card className="xl:col-span-3" title="% do CDI por produto – renda fixa bancária" subtitle="Bruto × líquido de IR/IOF × benchmark cadastrado no período">
          <div className="h-72 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={porProduto} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="produto" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} angle={-30} textAnchor="end" height={64} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} unit="%" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${fmtDec(v, 1)}% CDI`, n]} />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <ReferenceLine y={100} stroke="#788fa6" strokeDasharray="4 4" />
                <Bar dataKey="bruto" name="% CDI bruto" fill="#168eff" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="liquido" name="% CDI líquido" fill="#75980b" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line
                  dataKey="benchmark"
                  name="Benchmark"
                  stroke="#1d2d3e"
                  strokeWidth={0}
                  legendType="plainline"
                  activeDot={false}
                  isAnimationActive={false}
                  dot={(props: { cx?: number; cy?: number; index?: number }) => (
                    <line key={props.index} x1={(props.cx ?? 0) - 16} x2={(props.cx ?? 0) + 16} y1={props.cy} y2={props.cy} stroke="#1d2d3e" strokeWidth={3} strokeLinecap="round" />
                  )}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="xl:col-span-2" title="Da rentabilidade bruta à real" subtitle="Renda fixa bancária no período selecionado">
          <ul className="space-y-3 mt-1">
            {passos.map((x) => (
              <li key={x.rotulo}>
                <div className="flex items-center justify-between text-[13px] mb-1">
                  <span className={x.rotulo.startsWith("(") ? "text-label" : "font-bold text-text"}>{x.rotulo}</span>
                  <span className="tabular font-semibold" style={{ color: x.cor }}>
                    {fmtPct(x.v)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#eff1f2] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(Math.abs(x.v) / maxPasso) * 100}%`, backgroundColor: x.cor }} />
                </div>
              </li>
            ))}
          </ul>
          <MessageStrip className="mt-4">
            Rentabilidade real = (1 + líquida) ÷ (1 + IPCA do período) − 1. IPCA de {fmtPct(p.ipca12m)} a.a. conforme Premissas;
            {" "}o benchmark cadastrado ({pctCDI(bmk.pct)} do CDI no período, capitalizado dia a dia) teria rendido {fmtBRL(bmk.rendBenchmark)} sobre o mesmo capital.
          </MessageStrip>
        </Card>
      </div>
    </ReportPage>
  );
}

/** Grupo de KPIs do cabeçalho com legenda (consolidado × renda fixa bancária) */
function GrupoKpi({ titulo, divisor, children }: { titulo: string; divisor?: boolean; children: ReactNode }) {
  return (
    <div className={divisor ? "min-w-0 sm:border-l sm:border-line-soft sm:pl-8" : "min-w-0 shrink-0"}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-label mb-1.5">{titulo}</div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">{children}</div>
    </div>
  );
}
