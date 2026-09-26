import clsx from "clsx";
import { CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../components/fiori/Card";
import { FilterField, Select } from "../components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi } from "../components/fiori/Kpi";
import { MessageStrip } from "../components/fiori/MessageStrip";
import { ReportPage } from "../components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { ESCOPOS, useCarteira, type Escopo } from "../context/useDados";
import { fmtDate, fmtMonthLong, fmtMonthShort, lastMonthEnds } from "../lib/dates";
import { exportarExcel } from "../lib/exportar";
import { consolidarRentabilidade, evolucaoMensal, pctCDIEvolucao, rentabilidade, type MesEvolucao } from "../lib/finance";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../lib/format";
import { totalCarteira } from "../lib/indicadores";

const rel = relatorioPorId("r05");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

interface LinhaDef {
  rotulo: string;
  valor: (m: MesEvolucao) => number;
  total?: (ms: MesEvolucao[]) => number | null;
  tipo?: "valor" | "pct" | "cdi";
  destaque?: boolean;
  sinal?: -1 | 1;
}

const LINHAS: LinhaDef[] = [
  { rotulo: "Saldo inicial", valor: (m) => m.saldoInicial, total: (ms) => ms[0]?.saldoInicial ?? 0, destaque: true },
  { rotulo: "(+) Aplicações", valor: (m) => m.aplicacoes, total: (ms) => ms.reduce((s, m) => s + m.aplicacoes, 0) },
  { rotulo: "(−) Resgates líquidos", valor: (m) => m.resgatesLiquidos, total: (ms) => ms.reduce((s, m) => s + m.resgatesLiquidos, 0), sinal: -1 },
  { rotulo: "(+) Rendimentos brutos", valor: (m) => m.rendimentos, total: (ms) => ms.reduce((s, m) => s + m.rendimentos, 0) },
  { rotulo: "(−) IRRF", valor: (m) => m.irrf, total: (ms) => ms.reduce((s, m) => s + m.irrf, 0), sinal: -1 },
  { rotulo: "(−) IOF", valor: (m) => m.iof, total: (ms) => ms.reduce((s, m) => s + m.iof, 0), sinal: -1 },
  { rotulo: "Saldo final", valor: (m) => m.saldoFinal, total: (ms) => ms[ms.length - 1]?.saldoFinal ?? 0, destaque: true },
  { rotulo: "Rentabilidade do mês", valor: (m) => m.rentabMes, total: () => null, tipo: "pct" },
  { rotulo: "CDI do mês", valor: (m) => m.cdiMes, total: () => null, tipo: "pct" },
  { rotulo: "% do CDI", valor: (m) => m.pctCDI, total: (ms) => pctCDIEvolucao(ms), tipo: "cdi", destaque: true },
];

export function R05Evolucao() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, ops, posicoes } = useCarteira(escopo);
  const [mesSel, setMesSel] = useState<string | null>(null);

  const d = useMemo(() => {
    const fins = lastMonthEnds(p.dataBase, 13);
    const meses = evolucaoMensal(ops, fins.slice(1), p);
    const r03 = consolidarRentabilidade(rentabilidade(ops, fins[0], p.dataBase, p), fins[0], p.dataBase, p);
    return { meses, r03 };
  }, [ops, p]);

  const soma = (fn: (m: MesEvolucao) => number) => d.meses.reduce((s, m) => s + fn(m), 0);
  const rend12 = soma((m) => m.rendimentos);
  const pct12 = pctCDIEvolucao(d.meses);
  const saldoR01 = totalCarteira(posicoes);
  const final = d.meses[d.meses.length - 1];
  const conciliaR03 = Math.abs(rend12 - d.r03.rendimento) < 1;
  const conciliaR01 = Math.abs(final.saldoFinal - saldoR01) < 1;
  const mes = d.meses.find((m) => m.fim === mesSel) ?? final;

  const dadosGrafico = d.meses.map((m) => ({
    mes: fmtMonthShort(m.fim),
    saldo: m.saldoFinal / 1e6,
    aplicacoes: m.aplicacoes / 1e6,
    resgates: -m.resgatesBrutos / 1e6,
    pctCDI: m.pctCDI * 100,
  }));

  const exportar = () => {
    const colunas = [{ titulo: "Movimentação", largura: 26 }, ...d.meses.map((m) => ({ titulo: fmtMonthShort(m.fim), tipo: "moeda" as const, largura: 14 })), { titulo: "12 meses", tipo: "moeda" as const, largura: 16 }];
    exportarExcel(
      `R05_Evolucao_Mensal_${p.dataBase}.xlsx`,
      [
        {
          nome: "R05 - Evolução",
          titulo: "R05 – Evolução mensal das aplicações financeiras",
          subtitulo: ESCOPOS.find((e) => e.value === escopo)!.label,
          colunas,
          linhas: LINHAS.map((l) => [
            l.rotulo,
            ...d.meses.map((m) => (l.tipo ? l.valor(m) : l.valor(m) * (l.sinal ?? 1))),
            l.total ? (l.total(d.meses) ?? "") : "",
          ]),
          notas: [
            "Linhas de rentabilidade, CDI e % do CDI expressas em fração (formatar como %).",
            `Conciliação: rendimentos 12m = R03 (${fmtBRL(d.r03.rendimento)}); saldo final = posição do R01 (${fmtBRL(saldoR01)}).`,
          ],
        },
      ],
      p.dataBase,
    );
  };

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Saldo final" value={fmtCompact(final.saldoFinal)} sub={fmtDate(final.fim)} />
          <HeaderKpi label="Aplicações 12m" value={fmtCompact(soma((m) => m.aplicacoes))} />
          <HeaderKpi label="Resgates 12m" value={fmtCompact(soma((m) => m.resgatesBrutos))} sub="brutos" />
          <HeaderKpi label="Rendimentos 12m" value={fmtCompact(rend12)} state="positive" />
          <HeaderKpi label="% do CDI 12m" value={`${fmtDec(pct12 * 100, 1)}%`} state={pct12 >= 1 ? "positive" : "neutral"} />
        </>
      }
    >
      <div className="bg-white rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <FilterField label="Empresa">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
          </FilterField>
          <div className="sm:col-span-2 text-[13px] text-label sm:text-right">
            Janela: {fmtMonthLong(d.meses[0].fim)} a {fmtMonthLong(final.fim)} · valores em R$
          </div>
        </div>
      </div>

      <MessageStrip design={conciliaR03 && conciliaR01 ? "positive" : "critical"}>
        <span className="inline-flex flex-wrap gap-x-5 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Rendimentos 12m conciliados com o R03: <strong>{fmtBRL(d.r03.rendimento)}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saldo final igual à posição do R01: <strong>{fmtBRL(saldoR01)}</strong>
          </span>
        </span>
      </MessageStrip>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="Saldo final × % do CDI" subtitle="Saldo em R$ milhões (barras) e rentabilidade mensal em % do CDI (linha)">
          <div className="h-72 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dadosGrafico} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="mes" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                <YAxis yAxisId="v" tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="p" orientation="right" domain={[80, 110]} ticks={[80, 90, 100, 110]} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} unit="%" />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, n: string) => (n === "% do CDI" ? [`${fmtDec(v, 1)}%`, n] : [`R$ ${fmtDec(v, 2)} mi`, n])}
                />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <ReferenceLine yAxisId="p" y={100} stroke="#788fa6" strokeDasharray="4 4" />
                <Bar yAxisId="v" dataKey="saldo" name="Saldo final" fill="#168eff" radius={[4, 4, 0, 0]} />
                <Line yAxisId="p" dataKey="pctCDI" name="% do CDI" stroke="#c87b00" strokeWidth={2.5} dot={{ r: 3, fill: "#c87b00" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Aplicações × resgates" subtitle="Fluxo mensal em R$ milhões (resgates brutos, inclusive IR/IOF retidos)">
          <div className="h-72 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dadosGrafico} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="mes" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`R$ ${fmtDec(Math.abs(v), 2)} mi`, n]} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <ReferenceLine y={0} stroke="#a8b2bd" />
                <Bar dataKey="aplicacoes" name="Aplicações" stackId="f" fill="#30914c" radius={[4, 4, 0, 0]} />
                <Bar dataKey="resgates" name="Resgates" stackId="f" fill="#da6c6c" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Quadro de evolução mensal" subtitle="Clique no mês para ver as movimentações" bodyClassName="px-0 pb-0">
        <div className="overflow-x-auto fiori-scroll">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-[2] bg-white text-left pl-4 pr-3 py-2.5 font-semibold text-[13px] border-b border-[#a8b2bd] min-w-[180px]">Movimentação</th>
                {d.meses.map((m) => (
                  <th
                    key={m.fim}
                    onClick={() => setMesSel(m.fim)}
                    className={clsx(
                      "px-2.5 py-2.5 text-right font-semibold text-[13px] border-b border-[#a8b2bd] cursor-pointer whitespace-nowrap",
                      m.fim === mes.fim ? "bg-selected text-[#0057d2]" : "bg-white hover:bg-hover",
                    )}
                  >
                    {fmtMonthShort(m.fim)}
                  </th>
                ))}
                <th className="px-2.5 py-2.5 text-right font-bold text-[13px] border-b border-[#a8b2bd] bg-[#f5f6f7] whitespace-nowrap">12 meses</th>
              </tr>
            </thead>
            <tbody>
              {LINHAS.map((l) => {
                const fmt = (v: number | null) =>
                  v === null ? "" : l.tipo === "pct" ? fmtPct(v) : l.tipo === "cdi" ? `${fmtDec(v * 100, 1)}%` : fmtNum(v * (l.sinal ?? 1), { parens: true, dash: true });
                return (
                  <tr key={l.rotulo} className={l.destaque ? "font-bold" : ""}>
                    <td className={clsx("sticky left-0 z-[1] pl-4 pr-3 py-2 text-[13px] border-b border-line-soft whitespace-nowrap", l.destaque ? "bg-[#f5f6f7]" : "bg-white", l.tipo && "text-label font-normal")}>
                      {l.rotulo}
                    </td>
                    {d.meses.map((m) => (
                      <td
                        key={m.fim}
                        className={clsx(
                          "px-2.5 py-2 text-right tabular text-[13px] border-b border-line-soft whitespace-nowrap",
                          m.fim === mes.fim ? "bg-selected" : l.destaque ? "bg-[#f5f6f7]" : "",
                          l.tipo === "cdi" && (l.valor(m) >= 1 ? "text-positive" : "text-critical"),
                        )}
                      >
                        {fmt(l.valor(m))}
                      </td>
                    ))}
                    <td className="px-2.5 py-2 text-right tabular text-[13px] border-b border-line-soft bg-[#f5f6f7] font-bold whitespace-nowrap">
                      {l.total ? fmt(l.total(d.meses)) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title={`Aplicações – ${fmtMonthLong(mes.fim)}`} subtitle={`${mes.novasAplicacoes.length} operação(ões) · ${fmtBRL(mes.aplicacoes)}`}>
          <ListaMov
            itens={mes.novasAplicacoes.map((o) => ({
              k: o.transacao,
              titulo: `${o.produto} · ${o.contraparte}`,
              sub: `${fmtDate(o.dataAplicacao)} · Transação ${o.transacao}`,
              valor: o.principal,
            }))}
          />
        </Card>
        <Card title={`Resgates – ${fmtMonthLong(mes.fim)}`} subtitle={`${mes.resgates.length} operação(ões) · líquido ${fmtBRL(mes.resgatesLiquidos)}`}>
          <ListaMov
            itens={mes.resgates.map((r) => ({
              k: r.op.transacao,
              titulo: `${r.op.produto} · ${r.op.contraparte}`,
              sub: `${fmtDate(r.data)} · IR ${fmtBRL(r.ir)}${r.iof ? ` · IOF ${fmtBRL(r.iof)}` : ""}`,
              valor: r.liquido,
            }))}
          />
        </Card>
      </div>
    </ReportPage>
  );
}

function ListaMov({ itens }: { itens: { k: string; titulo: string; sub: string; valor: number }[] }) {
  if (!itens.length) return <p className="text-sm text-label py-3">Sem movimentações no mês.</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {itens.map((i) => (
        <li key={i.k} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text truncate">{i.titulo}</div>
            <div className="text-xs text-label">{i.sub}</div>
          </div>
          <span className="tabular font-semibold text-text whitespace-nowrap">{fmtBRL(i.valor)}</span>
        </li>
      ))}
    </ul>
  );
}
