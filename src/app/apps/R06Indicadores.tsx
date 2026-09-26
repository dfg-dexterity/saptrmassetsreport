import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../components/fiori/Card";
import { DataTable } from "../components/fiori/DataTable";
import { AXIS_STYLE, HeaderKpi } from "../components/fiori/Kpi";
import { MessageStrip } from "../components/fiori/MessageStrip";
import { ObjectStatus, semaforoState, Tag } from "../components/fiori/ObjectStatus";
import { ReportPage } from "../components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { OPERACOES } from "../data/carteira";
import { DIVIDAS, type Divida } from "../data/endividamento";
import { usePremissas } from "../context/PremissasContext";
import { fmtDate, fmtQuarter } from "../lib/dates";
import { exportarExcel } from "../lib/exportar";
import { posicoesEm } from "../lib/finance";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct, fmtX } from "../lib/format";
import { avaliarCovenants, calcularCarry, indicadoresTrimestre, SEMAFORO_TEXTO, trimestresAte, type IndicadoresTrimestre } from "../lib/indicadores";

const rel = relatorioPorId("r06");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

const SERIE: { rotulo: string; v: (i: IndicadoresTrimestre) => number; tipo: "valor" | "x" }[] = [
  { rotulo: "Dívida bruta", v: (i) => i.dividaBruta, tipo: "valor" },
  { rotulo: "(−) Caixa", v: (i) => i.caixa, tipo: "valor" },
  { rotulo: "(−) Aplicações financeiras", v: (i) => i.aplicacoes, tipo: "valor" },
  { rotulo: "Dívida líquida", v: (i) => i.dividaLiquida, tipo: "valor" },
  { rotulo: "EBITDA (12 meses)", v: (i) => i.ebitdaLTM, tipo: "valor" },
  { rotulo: "Despesa de juros (12 meses)", v: (i) => i.jurosLTM, tipo: "valor" },
  { rotulo: "Patrimônio líquido", v: (i) => i.patrimonioLiquido, tipo: "valor" },
  { rotulo: "DL / EBITDA", v: (i) => i.dlEbitda, tipo: "x" },
  { rotulo: "Cobertura de juros (EBITDA / juros)", v: (i) => i.cobertura, tipo: "x" },
  { rotulo: "Liquidez CP ((caixa + aplic. CP) / dívida CP)", v: (i) => i.liquidezCP, tipo: "x" },
  { rotulo: "DL / PL", v: (i) => i.dlPl, tipo: "x" },
];

export function R06Indicadores() {
  const { premissas: p } = usePremissas();

  const d = useMemo(() => {
    const serie = trimestresAte(p.dataBase).map((t) => indicadoresTrimestre(t, OPERACOES, p));
    const atual = serie[serie.length - 1];
    const carry = calcularCarry(posicoesEm(OPERACOES, p.dataBase, p), p);
    return { serie, atual, covenants: avaliarCovenants(atual), carry };
  }, [p]);

  const { atual, carry } = d;
  const totalDivida = DIVIDAS.reduce((s, x) => s + x.circulante + x.naoCirculante, 0);

  const exportar = () =>
    exportarExcel(
      `R06_Endividamento_x_Aplicacoes_${p.dataBase}.xlsx`,
      [
        {
          nome: "Indicadores",
          titulo: "R06 – Endividamento × Aplicações: série trimestral",
          subtitulo: "Consolidado",
          colunas: [{ titulo: "Indicador", largura: 44 }, ...d.serie.map((i) => ({ titulo: fmtQuarter(i.data), tipo: "decimal" as const, largura: 16 }))],
          linhas: SERIE.map((s) => [s.rotulo, ...d.serie.map((i) => s.v(i))]),
          notas: ["Valores em R$; indicadores em múltiplos (x)."],
        },
        {
          nome: "Covenants",
          titulo: `R06 – Covenants (posição ${fmtDate(atual.data)})`,
          colunas: [{ titulo: "Indicador", largura: 30 }, { titulo: "Tipo", largura: 10 }, { titulo: "Limite", tipo: "decimal" }, { titulo: "Atual", tipo: "decimal" }, { titulo: "Status", largura: 16 }, { titulo: "Fonte", largura: 40 }],
          linhas: d.covenants.map((c) => [c.indicador, c.tipo === "max" ? "Máximo" : "Mínimo", c.limite, c.valor, SEMAFORO_TEXTO[c.status], c.fonte]),
        },
        {
          nome: "Carry",
          titulo: "R06 – Carry: rentabilidade das aplicações × custo da dívida",
          colunas: [{ titulo: "Item", largura: 44 }, { titulo: "Valor", tipo: "decimal", largura: 18 }],
          linhas: [
            ["Saldo das aplicações (R$)", carry.saldo],
            ["Taxa bruta média ponderada (% a.a.)", carry.taxaBruta * 100],
            ["Alíquota média de IR (%)", carry.aliquotaMediaIR * 100],
            ["Taxa líquida média (% a.a.)", carry.taxaLiquida * 100],
            ["Custo médio da dívida (% a.a.)", carry.custoDivida * 100],
            ["Carry bruto (p.p.)", carry.carryBruto * 100],
            ["Custo/ganho de carregamento (R$ a.a.)", carry.custoCarregamento],
          ],
        },
        {
          nome: "Dívida",
          titulo: "Composição de empréstimos e financiamentos",
          colunas: [
            { titulo: "Modalidade", largura: 26 },
            { titulo: "Moeda", largura: 8 },
            { titulo: "Indexador", largura: 10 },
            { titulo: "Taxa efetiva", largura: 20 },
            { titulo: "Garantia", largura: 14 },
            { titulo: "Vencimento", tipo: "data", largura: 14 },
            { titulo: "Circulante", tipo: "moeda" },
            { titulo: "Não circulante", tipo: "moeda" },
            { titulo: "Total", tipo: "moeda" },
          ],
          linhas: DIVIDAS.map((x) => [x.modalidade, x.moeda, x.indexador, x.taxa, x.garantia, x.vencimento, x.circulante, x.naoCirculante, x.circulante + x.naoCirculante]),
          total: ["TOTAL", "", "", "", "", "", DIVIDAS.reduce((s, x) => s + x.circulante, 0), DIVIDAS.reduce((s, x) => s + x.naoCirculante, 0), totalDivida],
        },
      ],
      p.dataBase,
    );

  const grafico = d.serie.map((i) => ({
    tri: fmtQuarter(i.data),
    divida: i.dividaBruta / 1e6,
    caixa: i.caixaTotal / 1e6,
    dl: i.dividaLiquida / 1e6,
    dlEbitda: i.dlEbitda,
  }));
  const covDl = d.covenants.find((c) => c.id === "dlEbitda")!;
  const maxTaxa = Math.max(carry.taxaBruta, carry.custoDivida) * 1.1;

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Dívida bruta" value={fmtCompact(atual.dividaBruta)} sub={fmtQuarter(atual.data)} />
          <HeaderKpi label="Dívida líquida" value={fmtCompact(atual.dividaLiquida)} sub={`Caixa + aplic. ${fmtCompact(atual.caixaTotal)}`} />
          <HeaderKpi label="DL / EBITDA" value={fmtX(atual.dlEbitda)} state={semaforoState(covDl.status)} sub={`Covenant ≤ ${fmtX(covDl.limite, 1)}`} />
          <HeaderKpi label="Carry" value={`${fmtDec(carry.carryBruto * 100, 2)} p.p.`} state={carry.carryBruto >= 0 ? "positive" : "negative"} sub={`${fmtCompact(carry.custoCarregamento)} / ano`} />
        </>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card className="xl:col-span-3" title="Dívida bruta × caixa e aplicações" subtitle="R$ milhões (barras) e DL/EBITDA (linha) por trimestre">
          <div className="h-72 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={grafico} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="tri" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                <YAxis yAxisId="v" tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="x" orientation="right" domain={[0, 3.5]} ticks={[0, 1, 2, 3]} tickFormatter={(v: number) => `${v}x`} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={36} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => (n === "DL / EBITDA" ? [fmtX(v), n] : [`R$ ${fmtDec(v, 1)} mi`, n])} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <ReferenceLine yAxisId="x" y={covDl.limite} stroke="#f53232" strokeDasharray="4 4" label={{ value: `Covenant ${fmtX(covDl.limite, 1)}`, fill: "#aa0808", fontSize: 11, position: "insideTopRight" }} />
                <Bar yAxisId="v" dataKey="divida" name="Dívida bruta" fill="#df1278" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="v" dataKey="caixa" name="Caixa + aplicações" fill="#168eff" radius={[4, 4, 0, 0]} />
                <Line yAxisId="x" dataKey="dlEbitda" name="DL / EBITDA" stroke="#1d2d3e" strokeWidth={2.5} dot={{ r: 3.5, fill: "#1d2d3e" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Carry" subtitle="Rentabilidade das aplicações − custo da dívida (a.a.)">
          <div className="space-y-3 mt-1">
            <BarraTaxa rotulo="Aplicações – taxa bruta média" valor={carry.taxaBruta} max={maxTaxa} cor="#168eff" />
            <BarraTaxa rotulo={`Aplicações – taxa líquida (IR ${fmtPct(carry.aliquotaMediaIR, 1)})`} valor={carry.taxaLiquida} max={maxTaxa} cor="#75980b" />
            <BarraTaxa rotulo="Custo médio da dívida (Premissas)" valor={carry.custoDivida} max={maxTaxa} cor="#df1278" />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="rounded-lg bg-[#f5f6f7] px-3 py-2">
              <div className="text-xs text-label">Carry bruto</div>
              <div className={`text-xl font-bold tabular ${carry.carryBruto >= 0 ? "text-positive" : "text-negative"}`}>{fmtDec(carry.carryBruto * 100, 2)} p.p.</div>
            </div>
            <div className="rounded-lg bg-[#f5f6f7] px-3 py-2">
              <div className="text-xs text-label">{carry.custoCarregamento >= 0 ? "Ganho" : "Custo"} de carregamento</div>
              <div className={`text-xl font-bold tabular ${carry.custoCarregamento >= 0 ? "text-positive" : "text-negative"}`}>{fmtCompact(Math.abs(carry.custoCarregamento))}/ano</div>
            </div>
          </div>
          <p className="text-xs text-label mt-3 leading-relaxed">
            Manter {fmtCompact(carry.saldo)} aplicados enquanto a dívida custa {fmtPct(carry.custoDivida)} a.a. gera um carry de{" "}
            {fmtDec(carry.carryBruto * 100, 2)} p.p. Avalie pré-pagamento de dívidas caras × necessidade de liquidez.
          </p>
        </Card>
      </div>

      <Card title="Covenants" subtitle={`Posição de ${fmtDate(atual.data)} (último trimestre fechado até a data-base)`} bodyClassName="px-0 pb-0">
        <DataTable
          columns={[
            { key: "ind", header: "Indicador", value: (c) => c.indicador, render: (c) => <span className="font-semibold">{c.indicador}</span> },
            { key: "lim", header: "Limite", align: "right", value: (c) => c.limite, render: (c) => `${c.tipo === "max" ? "≤" : "≥"} ${fmtX(c.limite, 1)}` },
            { key: "val", header: "Atual", align: "right", value: (c) => c.valor, render: (c) => <span className="font-bold">{fmtX(c.valor)}</span> },
            {
              key: "folga",
              header: "Folga",
              align: "right",
              value: (c) => (c.tipo === "max" ? c.limite - c.valor : c.valor - c.limite),
              render: (c) => {
                const f = c.tipo === "max" ? c.limite - c.valor : c.valor - c.limite;
                return <span className={f >= 0 ? "text-positive" : "text-negative"}>{fmtX(f)}</span>;
              },
            },
            { key: "st", header: "Status", value: (c) => c.status, render: (c) => <ObjectStatus state={semaforoState(c.status)}>{SEMAFORO_TEXTO[c.status]}</ObjectStatus> },
            { key: "fonte", header: "Fonte", value: (c) => c.fonte, render: (c) => <span className="text-label">{c.fonte}</span> },
          ]}
          rows={d.covenants}
          rowKey={(c) => c.id}
        />
      </Card>

      <Card title="Série trimestral" subtitle="Valores em R$ · indicadores em múltiplos" bodyClassName="px-0 pb-0">
        <div className="overflow-x-auto fiori-scroll">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white text-left pl-4 pr-3 py-2.5 font-semibold text-[13px] border-b border-[#a8b2bd] min-w-[260px]">Indicador</th>
                {d.serie.map((i) => (
                  <th key={i.data} className="px-3 py-2.5 text-right font-semibold text-[13px] border-b border-[#a8b2bd] whitespace-nowrap">
                    {fmtQuarter(i.data)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SERIE.map((s) => (
                <tr key={s.rotulo} className={s.rotulo === "Dívida líquida" || s.tipo === "x" ? "font-semibold" : ""}>
                  <td className="sticky left-0 bg-white pl-4 pr-3 py-2 border-b border-line-soft whitespace-nowrap">{s.rotulo}</td>
                  {d.serie.map((i) => (
                    <td key={i.data} className="px-3 py-2 text-right tabular border-b border-line-soft whitespace-nowrap">
                      {s.tipo === "x" ? fmtX(s.v(i)) : fmtNum(s.v(i), { parens: s.rotulo.startsWith("(") })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Composição da dívida" subtitle={`Total ${fmtBRL(totalDivida)} · modelo do relatório “03 – Empréstimos e Financiamentos”`} bodyClassName="px-0 pb-0">
        <DataTable<Divida>
          columns={[
            { key: "mod", header: "Modalidade", value: (x) => x.modalidade, render: (x) => <span className="font-semibold">{x.modalidade}</span>, total: () => "Total" },
            { key: "moeda", header: "Moeda", value: (x) => x.moeda, render: (x) => <Tag color={x.moeda === "USD" ? "#049f9a" : undefined}>{x.moeda}</Tag> },
            { key: "taxa", header: "Taxa efetiva", value: (x) => x.taxa },
            { key: "gar", header: "Garantia", value: (x) => x.garantia },
            { key: "venc", header: "Vencimento", align: "right", value: (x) => x.vencimento, render: (x) => fmtDate(x.vencimento) },
            { key: "cp", header: "Circulante", align: "right", value: (x) => x.circulante, render: (x) => fmtNum(x.circulante, { dash: true }), total: (r) => fmtNum(r.reduce((s, x) => s + x.circulante, 0)) },
            { key: "lp", header: "Não circulante", align: "right", value: (x) => x.naoCirculante, render: (x) => fmtNum(x.naoCirculante, { dash: true }), total: (r) => fmtNum(r.reduce((s, x) => s + x.naoCirculante, 0)) },
            { key: "tot", header: "Total", align: "right", value: (x) => x.circulante + x.naoCirculante, render: (x) => <span className="font-semibold">{fmtNum(x.circulante + x.naoCirculante)}</span>, total: (r) => fmtNum(r.reduce((s, x) => s + x.circulante + x.naoCirculante, 0)) },
          ]}
          rows={DIVIDAS}
          rowKey={(x) => x.modalidade}
          showTotals
          defaultSort={{ key: "tot", dir: "desc" }}
        />
      </Card>

      <MessageStrip>
        Aplicações financeiras de cada trimestre calculadas a partir da carteira (R01) na respectiva data. Dívida, EBITDA,
        juros e PL são dados ilustrativos da demo. O custo médio da dívida é editável nas Premissas.
      </MessageStrip>
    </ReportPage>
  );
}

function BarraTaxa({ rotulo, valor, max, cor }: { rotulo: string; valor: number; max: number; cor: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[13px] mb-1">
        <span className="text-text">{rotulo}</span>
        <span className="font-bold tabular" style={{ color: cor }}>
          {fmtPct(valor)}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-[#eff1f2] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${(valor / max) * 100}%`, backgroundColor: cor }} />
      </div>
    </div>
  );
}
