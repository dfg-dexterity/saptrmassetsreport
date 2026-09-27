import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, SegmentedButton, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { ESCOPOS, useCarteira, type Escopo } from "../context/useDados";
import { fmtDate, lastMonthEnds, previousYearEnd } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { consolidarRentabilidade, rentabilidade, taxaContratada, type RentabOp } from "../lib/finance";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../../shared/lib/format";
import { useBenchmarks } from "../context/BenchmarkContext";
import { compararCarteira, compararOperacao, corExcesso, SITUACAO_STATE, SITUACAO_TEXTO } from "../lib/benchmark";

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

export function R03Rentabilidade() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const [periodo, setPeriodo] = useState<Periodo>("12m");
  const [status, setStatus] = useState<"todas" | "Ativa" | "Liquidada">("todas");
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
          nome: "R03 - Rentabilidade",
          titulo: "R03 – Rentabilidade realizada e real",
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
        <>
          <HeaderKpi label="Rendimento bruto" value={fmtCompact(cart.rendimento)} />
          <HeaderKpi label="Rendimento líquido" value={fmtCompact(cart.rendLiquido)} sub={`IR+IOF ${fmtCompact(cart.ir + cart.iof)}`} />
          <HeaderKpi label="% CDI bruto" value={pctCDI(cart.pctCDIBruto)} state={SITUACAO_STATE[bmk.situacao]} sub={`Benchmark ${pctCDI(bmk.pct)}`} />
          <HeaderKpi label="Excesso s/ benchmark" value={fmtCompact(bmk.excesso)} state={bmk.excesso >= 0 ? "positive" : "negative"} sub={SITUACAO_TEXTO[bmk.situacao]} />
          <HeaderKpi label="Rentabilidade real" value={fmtPct(cart.rentabReal)} state={cart.rentabReal >= 0 ? "positive" : "negative"} sub={`IPCA ${fmtPct(cart.ipcaPeriodo)}`} />
        </>
      }
    >
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <FilterField label="Empresa" className="lg:w-80">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
          </FilterField>
          <FilterField label="Status" className="lg:w-56">
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: "todas", label: "Todas as aplicações" },
                { value: "Ativa", label: "Somente ativas" },
                { value: "Liquidada", label: "Somente liquidadas" },
              ]}
            />
          </FilterField>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-label">Período</span>
            <SegmentedButton value={periodo} onChange={setPeriodo} items={PERIODOS} />
          </div>
          <div className="lg:ml-auto text-[13px] text-label">
            {fmtDate(inicio)} a {fmtDate(p.dataBase)} · CDI do período <strong className="text-text">{fmtPct(cart.cdiPeriodo)}</strong>
          </div>
        </div>
      </div>

      <Card title={`Rentabilidade por aplicação (${linhas.length})`} subtitle="Inclui aplicações liquidadas no período (rendimento até a data do resgate) · benchmark capitalizado dia a dia com a regra vigente em cada dia (* regra alterada no período)" bodyClassName="px-0 pb-0">
        <DataTable columns={colunas} rows={linhas} rowKey={(r) => r.op.transacao} showTotals defaultSort={{ key: "rend", dir: "desc" }} maxHeight={560} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card className="xl:col-span-3" title="% do CDI por tipo de produto" subtitle="Bruto × líquido de IR/IOF × benchmark cadastrado no período">
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
        <Card className="xl:col-span-2" title="Da rentabilidade bruta à real" subtitle="Carteira no período selecionado">
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
