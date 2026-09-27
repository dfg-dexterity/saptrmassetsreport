import clsx from "clsx";
import { CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { FilterField, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { ESCOPOS, useCarteira, type Escopo } from "../context/useDados";
import { fmtDate, fmtMonthLong, fmtMonthShort, lastMonthEnds } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { consolidarRentabilidade, evolucaoMensal, rentabilidade, type MesEvolucao, type RentabCarteira } from "../lib/finance";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../../shared/lib/format";
import { totalCarteira } from "../lib/indicadores";
import { useBenchmarks } from "../context/BenchmarkContext";
import { compararCarteira, corExcesso, situacaoBenchmark, SITUACAO_STATE, SITUACAO_TEXTO, type ComparacaoBenchmark, type SituacaoBenchmark } from "../lib/benchmark";

const rel = relatorioPorId("r05");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

/**
 * Mês do R05 com o benchmark cadastrado: rendimento do benchmark calculado aplicação a aplicação, dia a dia, com a
 * regra vigente em cada dia (mesma função do R03). O % do CDI do mês e o benchmark do mês usam a MESMA base (saldo
 * médio do mês), de modo que % do CDI − benchmark = excesso ÷ (saldo médio × CDI do mês).
 */
type MesR05 = MesEvolucao & { baseMedia: number; rendBmk: number; pctBmk: number; excesso: number; situacao: SituacaoBenchmark };

/** Coluna "12 meses": mesmo método do R03 (capital base de cada aplicação no início da janela de 12 meses) */
interface Total12m {
  r03: RentabCarteira;
  bmk: ComparacaoBenchmark;
}

const baseMedia = (m: MesEvolucao) => m.saldoInicial + 0.5 * (m.aplicacoes - m.resgatesBrutos);

const COR_SITUACAO: Record<SituacaoBenchmark, string> = {
  acima: "text-positive",
  "em linha": "text-info",
  abaixo: "text-critical",
};

interface LinhaDef {
  rotulo: string;
  valor: (m: MesR05) => number;
  total?: (ms: MesR05[], t: Total12m) => number | null;
  tipo?: "valor" | "pct" | "cdi" | "bmk";
  cor?: boolean;
  destaque?: boolean;
  sinal?: -1 | 1;
  /** total de 12 meses pelo método do R03 (nota ¹) */
  metodoR03?: boolean;
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
  { rotulo: "% do CDI", valor: (m) => m.pctCDI, total: (_, t) => t.r03.pctCDIBruto, tipo: "cdi", destaque: true, metodoR03: true },
  { rotulo: "Benchmark (% do CDI)", valor: (m) => m.pctBmk, total: (_, t) => t.bmk.pct, tipo: "bmk", metodoR03: true },
  { rotulo: "Excesso s/ benchmark (R$)", valor: (m) => m.excesso, total: (_, t) => t.bmk.excesso, cor: true, metodoR03: true },
];

export function R05Evolucao() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, ops, posicoes } = useCarteira(escopo);
  const { cadastro } = useBenchmarks();
  const [mesSel, setMesSel] = useState<string | null>(null);

  const d = useMemo(() => {
    const fins = lastMonthEnds(p.dataBase, 13);
    const meses: MesR05[] = evolucaoMensal(ops, fins.slice(1), p).map((m) => {
      const cmp = compararCarteira(rentabilidade(ops, m.inicio, m.fim, p), cadastro, p);
      const b = baseMedia(m);
      const peso = b * m.cdiMes;
      const pctBmk = peso > 0 ? cmp.rendBenchmark / peso : cmp.pct;
      return { ...m, baseMedia: b, rendBmk: cmp.rendBenchmark, pctBmk, excesso: m.rendimentos - cmp.rendBenchmark, situacao: situacaoBenchmark(m.pctCDI, pctBmk) };
    });
    const linhas12 = rentabilidade(ops, fins[0], p.dataBase, p);
    const total12: Total12m = { r03: consolidarRentabilidade(linhas12, fins[0], p.dataBase, p), bmk: compararCarteira(linhas12, cadastro, p) };
    return { meses, total12, r03: total12.r03 };
  }, [ops, p, cadastro]);

  const soma = (fn: (m: MesR05) => number) => d.meses.reduce((s, m) => s + fn(m), 0);
  const rend12 = soma((m) => m.rendimentos);
  // 12 meses pelo mesmo método do R03 / Benchmark / Launchpad
  const pct12 = d.total12.r03.pctCDIBruto;
  const bmk12 = d.total12.bmk.pct;
  const sit12 = d.total12.bmk.situacao;
  const excessoMeses = soma((m) => m.excesso);
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
    benchmark: m.pctBmk * 100,
  }));
  const valoresPct = dadosGrafico.flatMap((x) => [x.pctCDI, x.benchmark]);
  const pctMin = Math.min(80, Math.floor((Math.min(...valoresPct) - 2) / 10) * 10);
  const pctMax = Math.max(110, Math.ceil((Math.max(...valoresPct) + 2) / 10) * 10);
  const pctTicks = Array.from({ length: Math.round((pctMax - pctMin) / 10) + 1 }, (_, i) => pctMin + i * 10);

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
            l.total ? (l.total(d.meses, d.total12) ?? "") : "",
          ]),
          notas: [
            "Linhas de rentabilidade, CDI, % do CDI e benchmark expressas em fração (formatar como %).",
            "Benchmark do mês: rendimento que as aplicações do mês teriam gerado no benchmark cadastrado, calculado dia a dia com a regra vigente em cada dia (capital base × (Π (1 + DI diário × % da regra) − 1)), expresso sobre o saldo médio do mês – mesma base do % do CDI do mês; excesso = rendimentos − rendimento do benchmark.",
            `Coluna 12 meses de % do CDI, benchmark e excesso: mesmo método do R03 (capital base de cada aplicação no início da janela). A soma dos excessos mensais (${fmtBRL(excessoMeses)}) difere do excesso de 12 meses (${fmtBRL(d.total12.bmk.excesso)}) porque, mês a mês, o capital é recalculado com o rendimento realizado.`,
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
          <HeaderKpi
            label="% do CDI 12m"
            value={`${fmtDec(pct12 * 100, 1)}%`}
            state={SITUACAO_STATE[sit12]}
            sub={`Benchmark ${fmtDec(bmk12 * 100, 1)}% · ${SITUACAO_TEXTO[sit12].toLowerCase()} (método R03)`}
          />
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
        <Card title="Saldo final × % do CDI" subtitle="Saldo em R$ milhões (barras), % do CDI do mês e benchmark cadastrado (linhas)">
          <div className="h-72 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dadosGrafico} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="mes" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                <YAxis yAxisId="v" tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="p" orientation="right" domain={[pctMin, pctMax]} ticks={pctTicks} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} unit="%" />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, n: string) => (n === "% do CDI" || n === "Benchmark" ? [`${fmtDec(v, 1)}%`, n] : [`R$ ${fmtDec(v, 2)} mi`, n])}
                />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <ReferenceLine yAxisId="p" y={100} stroke="#788fa6" strokeDasharray="4 4" />
                <Bar yAxisId="v" dataKey="saldo" name="Saldo final" fill="#168eff" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="p" dataKey="pctCDI" name="% do CDI" stroke="#c87b00" strokeWidth={2.5} dot={{ r: 3, fill: "#c87b00" }} isAnimationActive={false} />
                <Line yAxisId="p" dataKey="benchmark" name="Benchmark" stroke="#1d2d3e" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
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
                <Bar dataKey="aplicacoes" name="Aplicações" stackId="f" fill="#30914c" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="resgates" name="Resgates" stackId="f" fill="#da6c6c" radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
                  v === null ? "" : l.tipo === "pct" ? fmtPct(v) : l.tipo === "cdi" || l.tipo === "bmk" ? `${fmtDec(v * 100, 1)}%` : fmtNum(v * (l.sinal ?? 1), { parens: true, dash: true });
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
                          l.tipo === "cdi" && COR_SITUACAO[m.situacao],
                          l.cor && corExcesso(l.valor(m)),
                        )}
                      >
                        {fmt(l.valor(m))}
                      </td>
                    ))}
                    <td
                      className={clsx(
                        "px-2.5 py-2 text-right tabular text-[13px] border-b border-line-soft bg-[#f5f6f7] font-bold whitespace-nowrap",
                        l.tipo === "cdi" && COR_SITUACAO[sit12],
                        l.cor && corExcesso(d.total12.bmk.excesso),
                      )}
                      title={l.metodoR03 ? "12 meses pelo mesmo método do R03 (nota ¹)" : undefined}
                    >
                      {l.total ? fmt(l.total(d.meses, d.total12)) : ""}
                      {l.metodoR03 && <sup className="ml-0.5 text-label font-normal">1</sup>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-label leading-relaxed border-t border-line-soft">
          Meses: % do CDI e benchmark sobre o saldo médio do mês (saldo inicial + ½ × (aplicações − resgates)); o benchmark é o
          rendimento que as mesmas aplicações teriam gerado no cadastro, capitalizado dia a dia com a regra vigente em cada dia.
          Cor do % do CDI: acima / em linha (±0,5 p.p.) / abaixo do benchmark. <sup>1</sup> 12 meses: mesmo método do R03 e do
          Launchpad (capital base de cada aplicação no início da janela). A soma dos excessos mensais ({fmtBRL(excessoMeses)})
          difere do excesso de 12 meses ({fmtBRL(d.total12.bmk.excesso)}) porque, mês a mês, o capital é recalculado com o
          rendimento realizado.
        </p>
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
