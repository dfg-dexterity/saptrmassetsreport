import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../components/fiori/Card";
import { DataTable, type Column } from "../components/fiori/DataTable";
import { FilterField, SegmentedButton, Select } from "../components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi } from "../components/fiori/Kpi";
import { MessageStrip } from "../components/fiori/MessageStrip";
import { ObjectStatus } from "../components/fiori/ObjectStatus";
import { ReportPage } from "../components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { ESCOPOS, useCarteira, type Escopo } from "../context/useDados";
import { fmtDate, lastMonthEnds, previousYearEnd } from "../lib/dates";
import { exportarExcel } from "../lib/exportar";
import { consolidarRentabilidade, rentabilidade, taxaContratada, type RentabOp } from "../lib/finance";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../lib/format";

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
  const inicio = inicioPeriodo(periodo, p.dataBase);

  const { linhas, cart } = useMemo(() => {
    const todas = rentabilidade(ops, inicio, p.dataBase, p);
    const linhas = status === "todas" ? todas : todas.filter((r) => r.status === status);
    return { linhas, cart: consolidarRentabilidade(linhas, inicio, p.dataBase, p) };
  }, [ops, inicio, p, status]);

  const porProduto = useMemo(() => {
    const map = new Map<string, RentabOp[]>();
    for (const r of linhas) map.set(r.op.produto, [...(map.get(r.op.produto) ?? []), r]);
    return [...map.entries()]
      .map(([produto, rs]) => {
        const c = consolidarRentabilidade(rs, inicio, p.dataBase, p);
        return { produto, bruto: c.pctCDIBruto * 100, liquido: c.pctCDILiquido * 100 };
      })
      .sort((a, b) => b.bruto - a.bruto);
  }, [linhas, inicio, p]);

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
        <ObjectStatus inverted icon={false} state={r.status === "Ativa" ? "positive" : "neutral"}>
          {r.status === "Ativa" ? "Ativa" : `Liquidada ${fmtDate(r.fim)}`}
        </ObjectStatus>
      ),
    },
    { key: "base", header: "Capital base", align: "right", headerTitle: "Saldo no início do período ou valor aplicado, se posterior", value: (r) => r.base, render: (r) => fmtNum(r.base) },
    { key: "rend", header: "Rendimento bruto", align: "right", value: (r) => r.rendimento, render: (r) => fmtNum(r.rendimento), total: () => fmtNum(cart.rendimento) },
    { key: "iof", header: "IOF", align: "right", value: (r) => r.iof, render: (r) => (r.iof ? <span className="text-critical">{fmtNum(r.iof)}</span> : <span className="text-label">–</span>), total: () => fmtNum(cart.iof) },
    { key: "ir", header: "IRRF", align: "right", value: (r) => r.ir, render: (r) => fmtNum(r.ir), total: () => fmtNum(cart.ir) },
    { key: "liq", header: "Rendimento líquido", align: "right", value: (r) => r.rendLiquido, render: (r) => <span className="font-semibold">{fmtNum(r.rendLiquido)}</span>, total: () => fmtNum(cart.rendLiquido) },
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
          ],
          linhas: linhas.map((r) => [r.op.transacao, r.op.produto, r.op.contraparte, taxaContratada(r.op), r.status, r.base, r.rendimento, r.iof, r.ir, r.rendLiquido, r.rentabBruta, r.pctCDIBruto, r.pctCDILiquido, r.rentabReal]),
          total: ["CARTEIRA", "", "", "", "", "", cart.rendimento, cart.iof, cart.ir, cart.rendLiquido, cart.rentabBruta, cart.pctCDIBruto, cart.pctCDILiquido, cart.rentabReal],
          notas: [
            `CDI do período: ${fmtPct(cart.cdiPeriodo)} · IPCA do período: ${fmtPct(cart.ipcaPeriodo)} (IPCA 12m das Premissas: ${fmtPct(p.ipca12m)}).`,
            "Rentabilidade real = (1 + rentabilidade líquida) / (1 + IPCA do período) − 1.",
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
          <HeaderKpi label="% CDI bruto" value={pctCDI(cart.pctCDIBruto)} state={cart.pctCDIBruto >= 1 ? "positive" : "neutral"} />
          <HeaderKpi label="% CDI líquido" value={pctCDI(cart.pctCDILiquido)} />
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

      <Card title={`Rentabilidade por aplicação (${linhas.length})`} subtitle="Inclui aplicações liquidadas no período (rendimento até a data do resgate)" bodyClassName="px-0 pb-0">
        <DataTable columns={colunas} rows={linhas} rowKey={(r) => r.op.transacao} showTotals defaultSort={{ key: "rend", dir: "desc" }} maxHeight={560} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card className="xl:col-span-3" title="% do CDI por tipo de produto" subtitle="Bruto × líquido de IR/IOF no período">
          <div className="h-72 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porProduto} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="produto" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} unit="%" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${fmtDec(v, 1)}% CDI`, n]} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <ReferenceLine y={100} stroke="#788fa6" strokeDasharray="4 4" />
                <Bar dataKey="bruto" name="% CDI bruto" fill="#168eff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="liquido" name="% CDI líquido" fill="#75980b" radius={[4, 4, 0, 0]} />
              </BarChart>
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
            {" "}benchmark de {fmtBRL(cart.rendimento / Math.max(cart.pctCDIBruto, 0.0001))} (100% do CDI sobre o mesmo capital).
          </MessageStrip>
        </Card>
      </div>
    </ReportPage>
  );
}
