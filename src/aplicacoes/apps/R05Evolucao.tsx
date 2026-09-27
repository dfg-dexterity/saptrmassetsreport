import clsx from "clsx";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { FilterField, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, CHART_SEMANTIC, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { ESCOPOS, useMestre, type Escopo } from "../context/useDados";
import { fmtDate, fmtMonthLong, fmtMonthShort, lastMonthEnds } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import {
  evolucaoMestre,
  rentabilidadeMestre,
  somaMestre,
  TIPOS_CONTRATO,
  type EventoMestre,
  type MesMestre,
  type RentabContrato,
  type TipoContrato,
} from "../lib/carteiraMestre";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct, plural } from "../../shared/lib/format";
import { PARAMETROS_TIME_DEPOSIT } from "../data/timeDeposits";
import { useBenchmarks } from "../context/BenchmarkContext";
import { compararCarteira, corExcesso, situacaoBenchmark, SITUACAO_STATE, type ComparacaoBenchmark, type SituacaoBenchmark } from "../lib/benchmark";

const rel = relatorioPorId("r05");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };
const legendStyle = { fontSize: 12, fontFamily: "72, Arial" };

/** Tolerância das checagens (R$): diferenças abaixo de meio centavo são ruído de ponto flutuante */
const TOL = 0.005;

/**
 * Mês do R05 (Carteira-Mestre) com o benchmark cadastrado: rendimento do benchmark calculado contrato a contrato, dia a
 * dia, com a regra vigente em cada dia (mesma função do R03). O % do CDI do mês e o benchmark do mês usam a MESMA base
 * (saldo médio do mês), de modo que % do CDI − benchmark = excesso ÷ (saldo médio × CDI do mês).
 */
type MesR05 = MesMestre & {
  baseMedia: number;
  rendBmk: number;
  pctBmk: number;
  excesso: number;
  situacao: SituacaoBenchmark;
  /** SI + aplicações + rendimentos − resgates brutos − come-cotas − SF (deve ser 0,00) */
  diferenca: number;
  /** IOF câmbio + tarifa pagos na remessa dos time deposits aplicados no mês (custo fora do saldo bruto) */
  remessaTD: number;
};

/** Coluna "12 meses": mesmo método do R03 consolidado (capital base de cada contrato no início da janela) */
interface Total12m {
  rendimento: number;
  pctCDI: number;
  bmk: ComparacaoBenchmark;
  /** identidade da janela: SI do 1º mês + fluxos − SF do último mês */
  diferenca: number;
  /** IOF do período no R03 (retido nos resgates + IOF câmbio na remessa dos time deposits) */
  iofR03: number;
  /** IOF câmbio e tarifa na remessa dos time deposits aplicados na janela */
  iofCambioTD: number;
  tarifaTD: number;
}

const baseMedia = (m: MesMestre) => m.saldoInicial + 0.5 * (m.aplicacoes - m.resgatesBrutos);
const identidade = (m: { saldoInicial: number; aplicacoes: number; rendimentos: number; resgatesBrutos: number; comeCotas: number; saldoFinal: number }) =>
  m.saldoInicial + m.aplicacoes + m.rendimentos - m.resgatesBrutos - m.comeCotas - m.saldoFinal;

const COR_SITUACAO: Record<SituacaoBenchmark, string> = {
  acima: "text-positive",
  "em linha": "text-info",
  abaixo: "text-critical",
};

interface LinhaDef {
  rotulo: string;
  valor: (m: MesR05) => number;
  total?: (ms: MesR05[], t: Total12m) => number | null;
  tipo?: "valor" | "pct" | "cdi" | "bmk" | "check";
  cor?: boolean;
  destaque?: boolean;
  /** linha "dos quais" (recuada, não soma) */
  recuo?: boolean;
  /** total de 12 meses pelo método do R03 (nota ¹) */
  metodoR03?: boolean;
}

const somaMeses = (fn: (m: MesR05) => number) => (ms: MesR05[]) => ms.reduce((s, m) => s + fn(m), 0);

const SECOES: { titulo: string; linhas: LinhaDef[] }[] = [
  {
    titulo: "Movimentação do saldo bruto",
    linhas: [
      { rotulo: "Saldo inicial", valor: (m) => m.saldoInicial, total: (ms) => ms[0]?.saldoInicial ?? 0, destaque: true },
      { rotulo: "(+) Aplicações", valor: (m) => m.aplicacoes, total: somaMeses((m) => m.aplicacoes) },
      { rotulo: "(−) Resgates brutos ²", valor: (m) => m.resgatesBrutos, total: somaMeses((m) => m.resgatesBrutos) },
      { rotulo: "(+) Rendimentos brutos ³", valor: (m) => m.rendimentos, total: somaMeses((m) => m.rendimentos) },
      { rotulo: "(−) Come-cotas ⁴", valor: (m) => m.comeCotas, total: somaMeses((m) => m.comeCotas) },
      { rotulo: "Saldo final", valor: (m) => m.saldoFinal, total: (ms) => ms[ms.length - 1]?.saldoFinal ?? 0, destaque: true },
      { rotulo: "Diferença (checagem)", valor: (m) => m.diferenca, total: (_, t) => t.diferenca, tipo: "check" },
    ],
  },
  {
    titulo: "Retenções na fonte e caixa",
    linhas: [
      { rotulo: "(−) IRRF (inclui come-cotas)", valor: (m) => m.irrf, total: somaMeses((m) => m.irrf) },
      { rotulo: "dos quais come-cotas", valor: (m) => m.comeCotas, total: somaMeses((m) => m.comeCotas), recuo: true },
      { rotulo: "(−) IOF", valor: (m) => m.iof, total: somaMeses((m) => m.iof) },
      { rotulo: "(−) Resgates líquidos (caixa)", valor: (m) => m.resgatesLiquidos, total: somaMeses((m) => m.resgatesLiquidos) },
      { rotulo: "IOF câmbio e tarifa na remessa (TDs) ⁵", valor: (m) => m.remessaTD, total: somaMeses((m) => m.remessaTD) },
    ],
  },
  {
    titulo: "Rentabilidade",
    linhas: [
      { rotulo: "Rentabilidade do mês", valor: (m) => m.rentabMes, total: () => null, tipo: "pct" },
      { rotulo: "CDI do mês", valor: (m) => m.cdiMes, total: () => null, tipo: "pct" },
      { rotulo: "% do CDI", valor: (m) => m.pctCDI, total: (_, t) => t.pctCDI, tipo: "cdi", destaque: true, metodoR03: true },
      { rotulo: "Benchmark (% do CDI)", valor: (m) => m.pctBmk, total: (_, t) => t.bmk.pct, tipo: "bmk", metodoR03: true },
      { rotulo: "Excesso s/ benchmark (R$)", valor: (m) => m.excesso, total: (_, t) => t.bmk.excesso, cor: true, metodoR03: true },
    ],
  },
];


export function R05Evolucao() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, contratos } = useMestre(escopo);
  const { cadastro } = useBenchmarks();
  const [mesSel, setMesSel] = useState<string | null>(null);

  const d = useMemo(() => {
    const fins = lastMonthEnds(p.dataBase, 13);
    // IOF câmbio e tarifa dos time deposits: pagos na remessa, à parte do valor aplicado – no R03 e nos KPIs (IOF e taxas)
    const remessa = (ls: RentabContrato[]) => ls.filter((l) => l.tipo === "Time deposit").reduce((s, l) => s + l.iof + l.taxas, 0);
    const meses: MesR05[] = evolucaoMestre(fins.slice(1), p, escopo).map((m) => {
      const linhasMes = rentabilidadeMestre(m.inicio, m.fim, p, escopo);
      const cmp = compararCarteira(linhasMes, cadastro, p);
      const b = baseMedia(m);
      const peso = b * m.cdiMes;
      const pctBmk = peso > 0 ? cmp.rendBenchmark / peso : cmp.pct;
      return {
        ...m,
        baseMedia: b,
        rendBmk: cmp.rendBenchmark,
        pctBmk,
        excesso: m.rendimentos - cmp.rendBenchmark,
        situacao: situacaoBenchmark(m.pctCDI, pctBmk),
        diferenca: identidade(m),
        remessaTD: remessa(linhasMes),
      };
    });
    const linhas12 = rentabilidadeMestre(fins[0], p.dataBase, p, escopo);
    const rend12 = linhas12.reduce((s, l) => s + l.rendimento, 0);
    const peso12 = linhas12.reduce((s, l) => s + l.base * l.cdiPeriodo, 0);
    const soma = (fn: (m: MesR05) => number) => meses.reduce((s, m) => s + fn(m), 0);
    const tds12 = linhas12.filter((l) => l.tipo === "Time deposit");
    const total12: Total12m = {
      rendimento: rend12,
      pctCDI: peso12 > 0 ? rend12 / peso12 : 0,
      bmk: compararCarteira(linhas12, cadastro, p),
      diferenca: identidade({
        saldoInicial: meses[0].saldoInicial,
        aplicacoes: soma((m) => m.aplicacoes),
        rendimentos: soma((m) => m.rendimentos),
        resgatesBrutos: soma((m) => m.resgatesBrutos),
        comeCotas: soma((m) => m.comeCotas),
        saldoFinal: meses[meses.length - 1].saldoFinal,
      }),
      iofR03: linhas12.reduce((s, l) => s + l.iof, 0),
      iofCambioTD: tds12.reduce((s, l) => s + l.iof, 0),
      tarifaTD: tds12.reduce((s, l) => s + l.taxas, 0),
    };
    return { meses, total12 };
  }, [p, escopo, cadastro]);

  const soma = (fn: (m: MesR05) => number) => d.meses.reduce((s, m) => s + fn(m), 0);
  const rend12 = soma((m) => m.rendimentos);
  const pct12 = d.total12.pctCDI;
  const bmk12 = d.total12.bmk.pct;
  const sit12 = d.total12.bmk.situacao;
  const excessoMeses = soma((m) => m.excesso);
  const iof12 = soma((m) => m.iof);
  const final = d.meses[d.meses.length - 1];
  const mes = d.meses.find((m) => m.fim === mesSel) ?? final;

  // Conciliação com a Carteira-Mestre (saldo bruto = Σ saldoCurva dos contratos ativos na data-base)
  const conc = useMemo(() => {
    const porTipo = TIPOS_CONTRATO.map((t) => {
      const cs = contratos.filter((c) => c.tipo === t.tipo);
      const r05 = final.porTipo[t.tipo].saldoFinal;
      const mestre = somaMestre(cs, "saldoCurva");
      return { ...t, contratos: cs.length, r05, mestre, dif: r05 - mestre };
    });
    const mestre = somaMestre(contratos, "saldoCurva");
    const contabil = somaMestre(contratos, "valorContabil");
    return { porTipo, mestre, contabil, mtm: contabil - mestre, dif: final.saldoFinal - mestre, n: contratos.length };
  }, [contratos, final]);

  const maxDifMes = Math.max(...d.meses.map((m) => Math.abs(m.diferenca)), Math.abs(d.total12.diferenca));
  const okIdentidade = maxDifMes < TOL;
  const okMestre = Math.abs(conc.dif) < TOL;
  const okR03 = Math.abs(rend12 - d.total12.rendimento) < 1;

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

  const dadosTipo = d.meses.map((m) => {
    const x: Record<string, string | number> = { mes: fmtMonthShort(m.fim) };
    for (const t of TIPOS_CONTRATO) x[t.tipo] = m.porTipo[t.tipo].saldoFinal / 1e6;
    return x;
  });
  // tipos sem saldo em nenhum mês ficam fora do gráfico e da legenda
  const tiposComSaldo = TIPOS_CONTRATO.filter((t) => d.meses.some((m) => Math.abs(m.porTipo[t.tipo].saldoFinal) > 0.5));
  const tiposComMov = TIPOS_CONTRATO.filter((t) =>
    d.meses.some((m) => {
      const x = m.porTipo[t.tipo];
      return Math.abs(x.saldoInicial) > 0.5 || Math.abs(x.saldoFinal) > 0.5 || Math.abs(x.rendimentos) > 0.5;
    }),
  );

  const aplicacoesMes = mes.eventos.filter((e) => e.tipo === "Aplicação");
  const saidasMes = mes.eventos.filter((e) => e.tipo !== "Aplicação");

  const exportar = () => {
    const colMeses = d.meses.map((m) => ({ titulo: fmtMonthShort(m.fim), tipo: "moeda" as const, largura: 14 }));
    const escopoTxt = ESCOPOS.find((e) => e.value === escopo)!.label;
    const porTipoLinhas = (fn: (m: MesMestre, t: TipoContrato) => number, total: (t: TipoContrato) => number) =>
      tiposComMov.map((t) => [`${t.tipo} (${t.origem})`, ...d.meses.map((m) => fn(m, t.tipo)), total(t.tipo)]);
    exportarExcel(
      `R05_Evolucao_Mensal_${p.dataBase}.xlsx`,
      [
        {
          nome: "R05 - Evolução",
          titulo: "R05 – Evolução mensal das aplicações financeiras (Carteira-Mestre)",
          subtitulo: `${escopoTxt} · renda fixa bancária, Tesouro Direto, fundos e time deposits`,
          colunas: [{ titulo: "Movimentação", largura: 40 }, ...colMeses, { titulo: "12 meses", tipo: "moeda" as const, largura: 16 }],
          linhas: SECOES.flatMap((s) => [
            [s.titulo.toUpperCase()],
            ...s.linhas.map((l) => [
              l.recuo ? `   ${l.rotulo}` : l.rotulo,
              ...d.meses.map((m) => l.valor(m)),
              l.total ? (l.total(d.meses, d.total12) ?? "") : "",
            ]),
          ]),
          notas: [
            "Identidade da movimentação: saldo final = saldo inicial + aplicações + rendimentos − resgates brutos − come-cotas (linha Diferença = 0,00).",
            "Saldo bruto: curva na renda fixa e nos títulos públicos, valor da cota nos fundos e saldo em moeda × PTAX nos time deposits.",
            "Linhas (−): valores positivos, deduzidos conforme o rótulo. Resgates brutos: resgates, vencimentos e cupons recebidos, antes de IRRF e IOF. Resgates líquidos = resgates brutos − IRRF (exceto come-cotas) − IOF.",
            "Rendimentos brutos: juros, cupons, variação das cotas e variação cambial dos time deposits (CPC 02).",
            "Come-cotas: IRRF antecipado em maio e novembro pela redução da quantidade de cotas, sem saída de caixa.",
            `IOF câmbio (${fmtPct(PARAMETROS_TIME_DEPOSIT.iofCambio)}) e tarifa na remessa dos time deposits: custo da remessa, pago à parte do valor aplicado e fora do saldo bruto (12 meses: IOF câmbio ${fmtBRL(d.total12.iofCambioTD)} e tarifas ${fmtBRL(d.total12.tarifaTD)}). O R03 e o Painel de KPIs somam o IOF câmbio ao IOF do período: ${fmtBRL(iof12)} + ${fmtBRL(d.total12.iofCambioTD)} = ${fmtBRL(d.total12.iofR03)}.`,
            "Linhas de rentabilidade, CDI, % do CDI e benchmark expressas em fração (formatar como %).",
            "Benchmark do mês: rendimento que os contratos do mês teriam gerado no benchmark cadastrado, calculado dia a dia com a regra vigente em cada dia (capital base × (Π (1 + DI diário × % da regra) − 1)), expresso sobre o saldo médio do mês – mesma base do % do CDI do mês; excesso = rendimentos − rendimento do benchmark.",
            `Coluna 12 meses de % do CDI, benchmark e excesso: mesmo método do R03 (capital base de cada contrato no início da janela). A soma dos excessos mensais (${fmtBRL(excessoMeses)}) difere do excesso de 12 meses (${fmtBRL(d.total12.bmk.excesso)}) porque, mês a mês, o capital é recalculado com o rendimento realizado.`,
            `Conciliação: saldo final de ${fmtDate(final.fim)} = Σ saldo bruto da Carteira-Mestre (${fmtBRL(conc.mestre, true)}; diferença ${fmtBRL(okMestre ? 0 : conc.dif, true)}); rendimentos 12m = R03 consolidado (${fmtBRL(d.total12.rendimento, true)}).`,
          ],
        },
        {
          nome: "Saldo por tipo",
          titulo: "R05 – Saldo final por tipo de contrato",
          subtitulo: escopoTxt,
          colunas: [{ titulo: "Tipo de contrato", largura: 32 }, ...colMeses, { titulo: "Carteira-Mestre", tipo: "moeda" as const, largura: 16 }],
          linhas: porTipoLinhas((m, t) => m.porTipo[t].saldoFinal, (t) => conc.porTipo.find((x) => x.tipo === t)!.mestre),
          total: ["Total", ...d.meses.map((m) => m.saldoFinal), conc.mestre],
          notas: ["Coluna Carteira-Mestre: Σ saldo bruto (saldoCurva) dos contratos ativos na data-base – igual ao saldo do último mês."],
        },
        {
          nome: "Rendimentos por tipo",
          titulo: "R05 – Rendimentos brutos por tipo de contrato",
          subtitulo: escopoTxt,
          colunas: [{ titulo: "Tipo de contrato", largura: 32 }, ...colMeses, { titulo: "12 meses", tipo: "moeda" as const, largura: 16 }],
          linhas: porTipoLinhas((m, t) => m.porTipo[t].rendimentos, (t) => d.meses.reduce((s, m) => s + m.porTipo[t].rendimentos, 0)),
          total: ["Total", ...d.meses.map((m) => m.rendimentos), rend12],
          notas: ["Time deposits: juros e variação cambial (PTAX de fim de mês). Fundos: variação das cotas antes do come-cotas."],
        },
        {
          nome: `Movimentos ${fmtMonthShort(mes.fim).replace("/", "-")}`,
          titulo: `R05 – Movimentações de ${fmtMonthLong(mes.fim)}`,
          subtitulo: escopoTxt,
          colunas: [
            { titulo: "Data", tipo: "data", largura: 12 },
            { titulo: "Evento", largura: 14 },
            { titulo: "Tipo de contrato", largura: 22 },
            { titulo: "Contrato", largura: 11 },
            { titulo: "Produto", largura: 36 },
            { titulo: "Contraparte", largura: 26 },
            { titulo: "Empresa", largura: 9 },
            { titulo: "Bruto", tipo: "moeda" },
            { titulo: "IRRF", tipo: "moeda" },
            { titulo: "IOF", tipo: "moeda" },
            { titulo: "Líquido", tipo: "moeda" },
          ],
          linhas: mes.eventos.map((e) => [e.data, e.tipo, e.tipoContrato, e.codigo, e.produto, e.contraparte, e.empresa, e.bruto, e.ir, e.iof, e.liquido]),
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
            sub={`Benchmark ${fmtDec(bmk12 * 100, 1)}% · ${sit12} (método R03)`}
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
            Janela: {fmtMonthLong(d.meses[0].fim)} a {fmtMonthLong(final.fim)} · Carteira-Mestre ({conc.n} contratos ativos) · valores em R$
          </div>
        </div>
      </div>

      <MessageStrip design={okIdentidade && okMestre && okR03 ? "positive" : "critical"}>
        <ul className="space-y-0.5">
          <Checagem ok={okMestre}>
            {okMestre ? (
              <>
                Saldo final de {fmtMonthShort(final.fim)} igual à Carteira-Mestre: <strong>{fmtBRL(conc.mestre)}</strong> (diferença {fmtBRL(0, true)})
              </>
            ) : (
              <>
                Saldo final de {fmtMonthShort(final.fim)} diverge da Carteira-Mestre ({fmtBRL(conc.mestre)}): diferença de <strong>{fmtBRL(conc.dif, true)}</strong>
              </>
            )}
          </Checagem>
          <Checagem ok={okIdentidade}>
            {okIdentidade ? (
              <>Identidade SI + aplicações + rendimentos − resgates brutos − come-cotas = SF fechada em todos os meses (diferença {fmtBRL(0, true)})</>
            ) : (
              <>
                Identidade SI + aplicações + rendimentos − resgates brutos − come-cotas = SF não fecha: diferença de até <strong>{fmtBRL(maxDifMes, true)}</strong>
              </>
            )}
          </Checagem>
          <Checagem ok={okR03}>
            {okR03 ? (
              <>
                Rendimentos 12m iguais ao R03 consolidado: <strong>{fmtBRL(d.total12.rendimento)}</strong>
              </>
            ) : (
              <>
                Rendimentos 12m ({fmtBRL(rend12)}) divergem do R03 consolidado: <strong>{fmtBRL(d.total12.rendimento)}</strong>
              </>
            )}
          </Checagem>
        </ul>
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
                <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
                <ReferenceLine yAxisId="p" y={100} stroke="#788fa6" strokeDasharray="4 4" />
                <Bar yAxisId="v" dataKey="saldo" name="Saldo final" fill="#168eff" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="p" dataKey="pctCDI" name="% do CDI" stroke="#c87b00" strokeWidth={2.5} dot={{ r: 3, fill: "#c87b00" }} isAnimationActive={false} />
                <Line yAxisId="p" dataKey="benchmark" name="Benchmark" stroke="#1d2d3e" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Aplicações × resgates" subtitle="Fluxo mensal em R$ milhões (resgates, vencimentos e cupons brutos, inclusive IR/IOF retidos)">
          <div className="h-72 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dadosGrafico} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="mes" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => fmtDec(v, 0)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`R$ ${fmtDec(Math.abs(v), 2)} mi`, n]} />
                <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
                <ReferenceLine y={0} stroke="#a8b2bd" />
                <Bar dataKey="aplicacoes" name="Aplicações" stackId="f" fill={CHART_SEMANTIC.good} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="resgates" name="Resgates" stackId="f" fill="#da6c6c" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Quadro de evolução mensal" subtitle="Carteira consolidada (Carteira-Mestre) · clique no mês para ver as movimentações" bodyClassName="px-0 pb-0">
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
              {SECOES.map((s, si) => (
                <Fragment key={s.titulo}>
                  <tr>
                    <td
                      className={clsx(
                        "sticky left-0 z-[1] bg-white pl-4 pr-3 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-label whitespace-nowrap border-b border-line-soft",
                        si === 0 ? "pt-2.5" : "pt-4",
                      )}
                    >
                      {s.titulo}
                    </td>
                    <td colSpan={d.meses.length + 1} className="border-b border-line-soft bg-white" />
                  </tr>
                  {s.linhas.map((l) => {
                    const fmt = (v: number | null) => {
                      if (v === null) return "";
                      if (l.tipo === "pct") return fmtPct(v);
                      if (l.tipo === "cdi" || l.tipo === "bmk") return `${fmtDec(v * 100, 1)}%`;
                      if (l.tipo === "check") return fmtDec(Math.abs(v) < TOL ? 0 : v, 2);
                      // linhas (−) mostram o valor positivo; negativos com "−" colado (sem parênteses)
                      return fmtNum(v, { dash: true });
                    };
                    const corCheck = (v: number | null) => l.tipo === "check" && v !== null && (Math.abs(v) < TOL ? "text-positive" : "text-negative font-bold");
                    const tot = l.total ? l.total(d.meses, d.total12) : null;
                    return (
                      <tr key={l.rotulo} className={l.destaque ? "font-bold" : ""}>
                        <td
                          className={clsx(
                            "sticky left-0 z-[1] pr-3 py-2 text-[13px] border-b border-line-soft whitespace-nowrap",
                            l.recuo ? "pl-8 italic" : "pl-4",
                            l.destaque ? "bg-[#f5f6f7]" : "bg-white",
                            (l.tipo || l.recuo) && "text-label font-normal",
                          )}
                        >
                          {l.rotulo}
                        </td>
                        {d.meses.map((m) => (
                          <td
                            key={m.fim}
                            className={clsx(
                              "px-2.5 py-2 text-right tabular text-[13px] border-b border-line-soft whitespace-nowrap",
                              m.fim === mes.fim ? "bg-selected" : l.destaque ? "bg-[#f5f6f7]" : "",
                              l.recuo && "text-label",
                              l.tipo === "cdi" && COR_SITUACAO[m.situacao],
                              l.cor && corExcesso(l.valor(m)),
                              corCheck(l.valor(m)),
                            )}
                          >
                            {fmt(l.valor(m))}
                          </td>
                        ))}
                        <td
                          className={clsx(
                            "px-2.5 py-2 text-right tabular text-[13px] border-b border-line-soft bg-[#f5f6f7] font-bold whitespace-nowrap",
                            l.recuo && "text-label font-normal",
                            l.tipo === "cdi" && COR_SITUACAO[sit12],
                            l.cor && corExcesso(d.total12.bmk.excesso),
                            corCheck(tot),
                          )}
                          title={l.metodoR03 ? "12 meses pelo mesmo método do R03 (nota ¹)" : undefined}
                        >
                          {fmt(tot)}
                          {l.metodoR03 && <sup className="ml-0.5 text-label font-normal">1</sup>}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 text-xs text-label leading-relaxed border-t border-line-soft space-y-1">
          <p>
            Saldo bruto da Carteira-Mestre: curva na renda fixa e nos títulos públicos, valor da cota nos fundos e saldo em moeda ×
            PTAX nos time deposits. <sup>2</sup> Resgates, vencimentos e cupons pelo valor bruto (antes de IRRF e IOF).{" "}
            <sup>3</sup> Juros, cupons, variação das cotas e variação cambial dos time deposits (CPC 02). <sup>4</sup> O come-cotas
            (maio e novembro) antecipa o IR dos fundos pela redução da quantidade de cotas, sem saída de caixa; também compõe o
            IRRF. Resgates líquidos = resgates brutos − IRRF retido nos resgates e cupons − IOF. <sup>5</sup> Custo da remessa dos
            time deposits (IOF câmbio de {fmtPct(PARAMETROS_TIME_DEPOSIT.iofCambio)} e tarifa bancária), pago à parte do valor aplicado:
            fica fora do saldo bruto e da movimentação. O R03 e o Painel de KPIs somam o IOF câmbio ao IOF do período – em 12 meses,{" "}
            {fmtBRL(iof12)} retidos nos resgates + {fmtBRL(d.total12.iofCambioTD)} de IOF câmbio = {fmtBRL(d.total12.iofR03)}; a tarifa (
            {fmtBRL(d.total12.tarifaTD)}) entra nas taxas.
          </p>
          <p>
            Meses: % do CDI e benchmark sobre o saldo médio do mês (saldo inicial + ½ × (aplicações − resgates)); o benchmark é o
            rendimento que os mesmos contratos teriam gerado no cadastro, capitalizado dia a dia com a regra vigente em cada dia.
            Cor do % do CDI: acima / em linha (±0,5 p.p.) / abaixo do benchmark. <sup>1</sup> 12 meses: mesmo método do R03 e do
            Launchpad (capital base de cada contrato no início da janela). A soma dos excessos mensais ({fmtBRL(excessoMeses)})
            difere do excesso de 12 meses ({fmtBRL(d.total12.bmk.excesso)}) porque, mês a mês, o capital é recalculado com o
            rendimento realizado.
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card className="xl:col-span-3" title="Saldo por tipo de contrato" subtitle="Saldo bruto no fim de cada mês, em R$ milhões">
          <div className="h-72 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dadosTipo} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="mes" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`R$ ${fmtDec(v, 2)} mi`, n]} />
                <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
                {tiposComSaldo.map((t) => (
                  <Bar key={t.tipo} dataKey={t.tipo} name={t.tipo} stackId="s" fill={t.cor} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          className="xl:col-span-2"
          title="Conciliação com a Carteira-Mestre"
          subtitle={`Saldo final de ${fmtMonthShort(final.fim)} × Σ saldo bruto dos contratos ativos em ${fmtDate(p.dataBase)}`}
          bodyClassName="px-0 pb-0"
        >
          <div className="overflow-x-auto fiori-scroll">
            <table className="w-full text-[13px] min-w-[420px]">
              <thead>
                <tr>
                  <th className="text-left font-semibold pl-4 pr-2 py-2 border-b border-[#a8b2bd]">Tipo de contrato</th>
                  <th className="text-right font-semibold px-2 py-2 border-b border-[#a8b2bd] whitespace-nowrap">R05</th>
                  <th className="text-right font-semibold px-2 py-2 border-b border-[#a8b2bd] whitespace-nowrap">Carteira-Mestre</th>
                  <th className="text-right font-semibold pl-2 pr-4 py-2 border-b border-[#a8b2bd]">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {conc.porTipo.map((t) => (
                  <tr key={t.tipo}>
                    <td className="pl-4 pr-2 py-2 border-b border-line-soft">
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
                        <span className="truncate">{t.tipo}</span>
                        <Link to={t.rota} className="text-link hover:underline text-xs whitespace-nowrap">
                          {t.origem}
                        </Link>
                      </span>
                      <div className="text-xs text-label pl-[18px]">{plural(t.contratos, "contrato", "contratos")}</div>
                    </td>
                    <td className="px-2 py-2 border-b border-line-soft text-right tabular whitespace-nowrap">{fmtNum(t.r05, { dash: true })}</td>
                    <td className="px-2 py-2 border-b border-line-soft text-right tabular whitespace-nowrap">{fmtNum(t.mestre, { dash: true })}</td>
                    <td className={clsx("pl-2 pr-4 py-2 border-b border-line-soft text-right tabular", Math.abs(t.dif) < TOL ? "text-positive" : "text-negative font-bold")}>
                      {fmtDec(Math.abs(t.dif) < TOL ? 0 : t.dif, 2)}
                    </td>
                  </tr>
                ))}
                <tr className="font-bold bg-[#f5f6f7]">
                  <td className="pl-4 pr-2 py-2.5 border-b border-[#a8b2bd]">Saldo bruto</td>
                  <td className="px-2 py-2.5 border-b border-[#a8b2bd] text-right tabular whitespace-nowrap">{fmtNum(final.saldoFinal)}</td>
                  <td className="px-2 py-2.5 border-b border-[#a8b2bd] text-right tabular whitespace-nowrap">{fmtNum(conc.mestre)}</td>
                  <td className={clsx("pl-2 pr-4 py-2.5 border-b border-[#a8b2bd] text-right tabular", okMestre ? "text-positive" : "text-negative")}>
                    {fmtDec(okMestre ? 0 : conc.dif, 2)}
                  </td>
                </tr>
                <tr>
                  <td className="pl-4 pr-2 py-2 border-b border-line-soft text-label">(±) Ajuste a valor justo (MTM)</td>
                  <td className="px-2 py-2 border-b border-line-soft" />
                  <td className="px-2 py-2 border-b border-line-soft text-right tabular text-label whitespace-nowrap">{fmtNum(conc.mtm, { dash: true })}</td>
                  <td className="pl-2 pr-4 py-2 border-b border-line-soft" />
                </tr>
                <tr className="font-semibold">
                  <td className="pl-4 pr-2 py-2">Saldo contábil (R02)</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right tabular whitespace-nowrap">{fmtNum(conc.contabil)}</td>
                  <td className="pl-2 pr-4 py-2" />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-label leading-relaxed border-t border-line-soft">
            Valores em R$. A movimentação usa o saldo bruto; o saldo contábil (nota explicativa do R02) soma o ajuste a valor justo
            dos contratos classificados a VJORA e VJR (CPC 48).
          </p>
        </Card>
      </div>

      <Card title="Rendimentos por tipo de contrato" subtitle="Rendimentos brutos do mês em R$ · a linha Total é a mesma do quadro de evolução" bodyClassName="px-0 pb-0">
        <div className="overflow-x-auto fiori-scroll">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-[2] bg-white text-left pl-4 pr-3 py-2.5 font-semibold text-[13px] border-b border-[#a8b2bd] min-w-[200px]">Tipo de contrato</th>
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
              {tiposComMov.map((t) => (
                <tr key={t.tipo}>
                  <td className="sticky left-0 z-[1] bg-white pl-4 pr-3 py-2 text-[13px] border-b border-line-soft whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
                      {t.tipo}
                      <span className="text-xs text-label">{t.origem}</span>
                    </span>
                  </td>
                  {d.meses.map((m) => {
                    const v = m.porTipo[t.tipo].rendimentos;
                    return (
                      <td
                        key={m.fim}
                        className={clsx(
                          "px-2.5 py-2 text-right tabular text-[13px] border-b border-line-soft whitespace-nowrap",
                          m.fim === mes.fim && "bg-selected",
                          Math.round(v) < 0 && "text-negative",
                        )}
                      >
                        {fmtNum(v, { dash: true })}
                      </td>
                    );
                  })}
                  <td className="px-2.5 py-2 text-right tabular text-[13px] border-b border-line-soft bg-[#f5f6f7] font-bold whitespace-nowrap">
                    {fmtNum(
                      d.meses.reduce((s, m) => s + m.porTipo[t.tipo].rendimentos, 0),
                      { dash: true },
                    )}
                  </td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="sticky left-0 z-[1] bg-[#f5f6f7] pl-4 pr-3 py-2.5 text-[13px] border-b border-[#a8b2bd] whitespace-nowrap">Total</td>
                {d.meses.map((m) => (
                  <td
                    key={m.fim}
                    className={clsx("px-2.5 py-2.5 text-right tabular text-[13px] border-b border-[#a8b2bd] whitespace-nowrap", m.fim === mes.fim ? "bg-selected" : "bg-[#f5f6f7]")}
                  >
                    {fmtNum(m.rendimentos, { dash: true })}
                  </td>
                ))}
                <td className="px-2.5 py-2.5 text-right tabular text-[13px] border-b border-[#a8b2bd] bg-[#f5f6f7] whitespace-nowrap">{fmtNum(rend12)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-label leading-relaxed">
          Time deposits: juros em moeda e variação cambial pela PTAX de fim de mês (valores negativos indicam apreciação do real).
          Fundos: variação das cotas, antes do come-cotas.
        </p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title={`Aplicações – ${fmtMonthLong(mes.fim)}`} subtitle={`${plural(aplicacoesMes.length, "contrato", "contratos")} · ${fmtBRL(mes.aplicacoes)}`}>
          <ListaMov
            itens={aplicacoesMes.map((e) => ({
              k: `${e.codigo}-${e.data}-${e.tipo}`,
              cor: corTipo(e.tipoContrato),
              titulo: `${e.produto} · ${e.contraparte}`,
              sub: `${fmtDate(e.data)} · ${e.tipoContrato} · ${e.codigo} · empresa ${e.empresa}`,
              valor: fmtBRL(e.bruto),
            }))}
          />
        </Card>
        <Card
          title={`Resgates, vencimentos e cupons – ${fmtMonthLong(mes.fim)}`}
          subtitle={`${plural(saidasMes.length, "evento", "eventos")} · bruto ${fmtBRL(mes.resgatesBrutos)} · líquido ${fmtBRL(mes.resgatesLiquidos)}`}
        >
          <ListaMov itens={saidasMes.map(itemSaida)} />
        </Card>
      </div>
    </ReportPage>
  );
}

const corTipo = (t: TipoContrato) => TIPOS_CONTRATO.find((x) => x.tipo === t)?.cor ?? "#758ca4";

function itemSaida(e: EventoMestre) {
  const base = { k: `${e.codigo}-${e.data}-${e.tipo}`, cor: corTipo(e.tipoContrato) };
  if (e.tipo === "Come-cotas") {
    return {
      ...base,
      titulo: `Come-cotas · ${e.produto}`,
      sub: `${fmtDate(e.data)} · ${e.codigo} · IR antecipado por redução de cotas, sem saída de caixa`,
      valor: `IR ${fmtBRL(e.ir)}`,
    };
  }
  const ret = [e.ir ? `IR ${fmtBRL(e.ir)}` : "", e.iof ? `IOF ${fmtBRL(e.iof)}` : ""].filter(Boolean).join(" · ");
  return {
    ...base,
    titulo: `${e.tipo} · ${e.produto} · ${e.contraparte}`,
    sub: `${fmtDate(e.data)} · ${e.tipoContrato} · ${e.codigo} · bruto ${fmtBRL(e.bruto)}${ret ? ` · ${ret}` : ""}`,
    valor: fmtBRL(e.liquido),
  };
}

/** Item de checagem dentro da MessageStrip (o ícone é o da própria faixa): o texto já diz se confere ou diverge */
function Checagem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <li className={ok ? undefined : "text-negative"}>{children}</li>;
}

function ListaMov({ itens }: { itens: { k: string; cor: string; titulo: string; sub: string; valor: string }[] }) {
  if (!itens.length) return <p className="text-sm text-label py-3">Sem movimentações no mês.</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {itens.map((i) => (
        <li key={i.k} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0 flex items-start gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: i.cor }} />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text truncate">{i.titulo}</div>
              <div className="text-xs text-label">{i.sub}</div>
            </div>
          </div>
          <span className="tabular font-semibold text-text whitespace-nowrap">{i.valor}</span>
        </li>
      ))}
    </ul>
  );
}
