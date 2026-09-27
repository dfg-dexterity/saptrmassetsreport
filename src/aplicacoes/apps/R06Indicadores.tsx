import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable } from "../../shared/components/fiori/DataTable";
import { AXIS_STYLE, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, semaforoState, Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { OPERACOES } from "../data/carteira";
import { CONTRATOS, GRUPO_MODALIDADE } from "../../captacoes/data/contratos";
import { reclassificadosEm } from "../../captacoes/lib/covenants";
import { custoMedioPonderado, posicoesDivida, type PosicaoDivida } from "../../captacoes/lib/divida";
import { usePremissas } from "../../shared/context/MercadoContext";
import { fmtDate, fmtQuarter } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { posicoesEm } from "../lib/finance";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct, fmtX } from "../../shared/lib/format";
import { avaliarCovenants, calcularCarry, indicadoresTrimestre, SEMAFORO_TEXTO, trimestresAte, type IndicadoresTrimestre } from "../lib/indicadores";

const rel = relatorioPorId("r06");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

const SERIE: { rotulo: string; v: (i: IndicadoresTrimestre) => number; tipo: "valor" | "x" }[] = [
  { rotulo: "Dívida bruta", v: (i) => i.dividaBruta, tipo: "valor" },
  { rotulo: "(−) Caixa", v: (i) => i.caixa, tipo: "valor" },
  { rotulo: "(−) Aplicações financeiras", v: (i) => i.aplicacoes, tipo: "valor" },
  { rotulo: "Dívida líquida", v: (i) => i.dividaLiquida, tipo: "valor" },
  { rotulo: "EBITDA (12 meses)", v: (i) => i.ebitdaLTM, tipo: "valor" },
  { rotulo: "Encargos da dívida (12 meses)", v: (i) => i.encargosLTM, tipo: "valor" },
  { rotulo: "Patrimônio líquido", v: (i) => i.patrimonioLiquido, tipo: "valor" },
  { rotulo: "DL / EBITDA", v: (i) => i.dlEbitda, tipo: "x" },
  { rotulo: "Cobertura (EBITDA / encargos)", v: (i) => i.cobertura, tipo: "x" },
  { rotulo: "Liquidez CP ((caixa + aplic. CP) / dívida CP)", v: (i) => i.liquidezCP, tipo: "x" },
  { rotulo: "DL / PL", v: (i) => i.dlPl, tipo: "x" },
];

export function R06Indicadores() {
  const { premissas: p } = usePremissas();

  const d = useMemo(() => {
    const serie = trimestresAte(p.dataBase).map((t) => indicadoresTrimestre(t));
    const atual = serie[serie.length - 1];
    const carry = calcularCarry(posicoesEm(OPERACOES, p.dataBase, p), p);
    const dividas = composicaoDivida(posicoesDivida(CONTRATOS, p.dataBase, p, reclassificadosEm(p.dataBase)));
    return { serie, atual, covenants: avaliarCovenants(atual), carry, dividas };
  }, [p]);

  const { atual, carry, dividas } = d;
  const totalDivida = dividas.reduce((s, x) => s + x.circulante + x.naoCirculante, 0);

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
            { titulo: "Contratos", tipo: "inteiro", largura: 10 },
            { titulo: "Indexadores", largura: 16 },
            { titulo: "Taxa efetiva média (% a.a.)", tipo: "decimal", largura: 16 },
            { titulo: "Vencimento final", tipo: "data", largura: 14 },
            { titulo: "Circulante", tipo: "moeda" },
            { titulo: "Não circulante", tipo: "moeda" },
            { titulo: "Total", tipo: "moeda" },
          ],
          linhas: dividas.map((x) => [x.modalidade, x.contratos, x.indexadores, x.taxa * 100, x.vencimento, x.circulante, x.naoCirculante, x.circulante + x.naoCirculante]),
          total: ["TOTAL", dividas.reduce((s, x) => s + x.contratos, 0), "", carry.custoDivida * 100, "", dividas.reduce((s, x) => s + x.circulante, 0), dividas.reduce((s, x) => s + x.naoCirculante, 0), totalDivida],
          notas: ["Carteira de captações do mesmo ambiente SAP (C00), pelo custo amortizado."],
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
                <Bar yAxisId="v" dataKey="divida" name="Dívida bruta" fill="#df1278" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar yAxisId="v" dataKey="caixa" name="Caixa + aplicações" fill="#168eff" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="x" dataKey="dlEbitda" name="DL / EBITDA" stroke="#1d2d3e" strokeWidth={2.5} dot={{ r: 3.5, fill: "#1d2d3e" }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Carry" subtitle="Rentabilidade das aplicações − custo da dívida (a.a.)">
          <div className="space-y-3 mt-1">
            <BarraTaxa rotulo="Aplicações – taxa bruta média" valor={carry.taxaBruta} max={maxTaxa} cor="#168eff" />
            <BarraTaxa rotulo={`Aplicações – taxa líquida (IR ${fmtPct(carry.aliquotaMediaIR, 1)})`} valor={carry.taxaLiquida} max={maxTaxa} cor="#75980b" />
            <BarraTaxa rotulo="Custo médio ponderado da dívida (C03)" valor={carry.custoDivida} max={maxTaxa} cor="#df1278" />
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

      <Card title="Composição da dívida" subtitle={`Total ${fmtBRL(totalDivida)} pelo custo amortizado · carteira de captações (C00)`} bodyClassName="px-0 pb-0">
        <DataTable<LinhaDivida>
          columns={[
            { key: "mod", header: "Modalidade", value: (x) => x.modalidade, render: (x) => <span className="font-semibold">{x.modalidade}</span>, total: () => "Total" },
            { key: "qtd", header: "Contratos", align: "right", value: (x) => x.contratos, total: (r) => String(r.reduce((s, x) => s + x.contratos, 0)) },
            {
              key: "idx",
              header: "Indexadores",
              value: (x) => x.indexadores,
              render: (x) => (
                <span className="inline-flex flex-wrap gap-1">
                  {x.indexadores.split(", ").map((i) => (
                    <Tag key={i}>{i}</Tag>
                  ))}
                </span>
              ),
            },
            { key: "taxa", header: "Taxa efetiva média", align: "right", value: (x) => x.taxa, render: (x) => `${fmtPct(x.taxa)} a.a.`, total: () => `${fmtPct(carry.custoDivida)} a.a.` },
            { key: "venc", header: "Vencimento final", align: "right", value: (x) => x.vencimento, render: (x) => fmtDate(x.vencimento) },
            { key: "cp", header: "Circulante", align: "right", value: (x) => x.circulante, render: (x) => fmtNum(x.circulante, { dash: true }), total: (r) => fmtNum(r.reduce((s, x) => s + x.circulante, 0)) },
            { key: "lp", header: "Não circulante", align: "right", value: (x) => x.naoCirculante, render: (x) => fmtNum(x.naoCirculante, { dash: true }), total: (r) => fmtNum(r.reduce((s, x) => s + x.naoCirculante, 0)) },
            { key: "tot", header: "Total", align: "right", value: (x) => x.circulante + x.naoCirculante, render: (x) => <span className="font-semibold">{fmtNum(x.circulante + x.naoCirculante)}</span>, total: (r) => fmtNum(r.reduce((s, x) => s + x.circulante + x.naoCirculante, 0)) },
          ]}
          rows={dividas}
          rowKey={(x) => x.modalidade}
          showTotals
          defaultSort={{ key: "tot", dir: "desc" }}
        />
      </Card>

      <MessageStrip>
        Aplicações financeiras de cada trimestre calculadas a partir da carteira (R01) na respectiva data. Dívida, encargos e
        custo médio ponderado vêm da carteira de captações do mesmo ambiente SAP (C00/C03); EBITDA e PL são dados
        corporativos fictícios do ambiente de teste.
      </MessageStrip>
    </ReportPage>
  );
}

interface LinhaDivida {
  modalidade: string;
  contratos: number;
  indexadores: string;
  taxa: number;
  vencimento: string;
  circulante: number;
  naoCirculante: number;
}

/** Composição por modalidade no modelo do relatório “03 – Empréstimos e Financiamentos” */
function composicaoDivida(pos: PosicaoDivida[]): LinhaDivida[] {
  const grupos = new Map<string, PosicaoDivida[]>();
  for (const x of pos) {
    const g = GRUPO_MODALIDADE[x.c.modalidade];
    grupos.set(g, [...(grupos.get(g) ?? []), x]);
  }
  return [...grupos.entries()].map(([modalidade, xs]) => ({
    modalidade,
    contratos: xs.length,
    indexadores: [...new Set(xs.map((x) => x.c.indexador))].join(", "),
    taxa: custoMedioPonderado(xs),
    vencimento: xs.reduce((m, x) => (x.c.vencimento > m ? x.c.vencimento : m), ""),
    circulante: xs.reduce((s, x) => s + x.circulante, 0),
    naoCirculante: xs.reduce((s, x) => s + x.naoCirculante, 0),
  }));
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
