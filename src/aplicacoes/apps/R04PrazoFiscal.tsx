import { Calculator } from "lucide-react";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, NumberInput, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, CHART_SEMANTIC, HeaderKpi, MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { TABELA_IRRF } from "../data/tributacao";
import { ESCOPOS, useCarteira, type Escopo } from "../context/useDados";
import { fmtDate } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { aliquotaIOF, aliquotaIR, analiseFiscal, simularCargaTributaria, taxaContratada, type AnaliseFiscal, type Recomendacao } from "../lib/finance";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../../shared/lib/format";

const rel = relatorioPorId("r04");
const tooltipStyle = { backgroundColor: "#2e2e2e", border: "1px solid rgba(247, 243, 231, 0.13)", borderRadius: 0, color: "#f7f3e7", fontFamily: "Figtree, system-ui, sans-serif", fontSize: 12 };

const REC_STATE: Record<Recomendacao, ValueState> = {
  "Evitar resgate (IOF)": "negative",
  "Aguardar próxima faixa": "critical",
  "Faixa mínima atingida": "positive",
  "Sem restrição fiscal": "information",
  "Alíquota fixa": "neutral",
};

const TODAS = "__todas";

export function R04PrazoFiscal() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const [filtro, setFiltro] = useState<string>(TODAS);
  const { premissas: p, posicoes } = useCarteira(escopo);

  const analises = useMemo(() => posicoes.map((x) => analiseFiscal(x, p)), [posicoes, p]);
  const linhas = filtro === TODAS ? analises : analises.filter((a) => a.recomendacao === filtro);
  const aguardar = analises.filter((a) => a.recomendacao === "Aguardar próxima faixa");
  const iof = analises.filter((a) => a.recomendacao === "Evitar resgate (IOF)");
  const totalRend = analises.reduce((s, a) => s + a.pos.rendimento, 0);
  const aliqMedia = totalRend > 0 ? analises.reduce((s, a) => s + a.pos.aliqIR * a.pos.rendimento, 0) / totalRend : 0;

  const faixas = useMemo(() => {
    const grupos = [...TABELA_IRRF.map((f) => ({ rotulo: `${fmtPct(f.aliquota, 1)} · ${f.faixa}`, aliq: f.aliquota, fixo: false })), { rotulo: "15% fixo · Lei 12.431", aliq: 0.15, fixo: true }];
    return grupos.map((g) => {
      const itens = analises.filter((a) => (g.fixo ? a.pos.op.regimeIR === "15% fixo" : a.pos.op.regimeIR === "Regressivo" && a.pos.aliqIR === g.aliq));
      return { ...g, qtd: itens.length, valor: itens.reduce((s, a) => s + a.pos.valorBruto, 0) };
    });
  }, [analises]);
  const maxFaixa = Math.max(...faixas.map((f) => f.valor), 1);

  const colunas: Column<AnaliseFiscal>[] = [
    {
      key: "op",
      header: "Aplicação",
      sticky: true,
      minWidth: 200,
      value: (a) => a.pos.op.contraparte,
      render: (a) => (
        <div>
          <div className="font-semibold text-text">
            {a.pos.op.produto} · {a.pos.op.contraparte}
          </div>
          <div className="text-xs text-label">
            {a.pos.op.transacao} · {taxaContratada(a.pos.op)}
          </div>
        </div>
      ),
    },
    {
      key: "rec",
      header: "Recomendação",
      value: (a) => a.recomendacao,
      render: (a) => (
        <ObjectStatus state={REC_STATE[a.recomendacao]} inverted={a.recomendacao !== "Sem restrição fiscal"}>
          {a.recomendacao}
        </ObjectStatus>
      ),
    },
    { key: "dias", header: "Dias corridos", align: "right", value: (a) => a.pos.diasCorridos },
    {
      key: "faixa",
      header: "Alíquota atual",
      align: "right",
      value: (a) => a.pos.aliqIR,
      render: (a) => (
        <div>
          <div className="font-semibold">{fmtPct(a.pos.aliqIR, 1)}</div>
          {a.pos.aliqIOF > 0 && <div className="text-xs text-negative font-semibold">+ IOF {fmtPct(a.pos.aliqIOF, 0)}</div>}
        </div>
      ),
    },
    {
      key: "prox",
      header: "Próxima faixa",
      minWidth: 170,
      value: (a) => a.diasAteProxima ?? 99999,
      render: (a) =>
        a.proxima ? (
          <div>
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="font-semibold">{fmtPct(a.proxima.aliquota, 1)}</span>
              <span className={a.diasAteProxima! <= 45 ? "text-critical font-semibold" : "text-label"}>em {a.diasAteProxima} dias</span>
            </div>
            <MicroBar
              value={a.pos.diasCorridos}
              max={a.proxima.aPartirDe}
              color={a.venceAntes ? "#575653" : a.diasAteProxima! <= 45 ? CHART_SEMANTIC.critical : "#4f8fd1"}
              className="mt-1"
            />
            <div className="text-[11px] text-label mt-0.5">{a.venceAntes ? `Vence antes (${fmtDate(a.pos.op.dataVencimento)})` : fmtDate(a.dataProxima)}</div>
          </div>
        ) : (
          <span className="text-label">{a.pos.op.regimeIR === "Regressivo" ? "Faixa mínima (15%)" : a.pos.op.regimeIR}</span>
        ),
    },
    { key: "rend", header: "Rendimento apropriado", align: "right", value: (a) => a.pos.rendimento, render: (a) => fmtNum(a.pos.rendimento) },
    { key: "irhoje", header: "IR se resgatar hoje", align: "right", value: (a) => a.irHoje + a.pos.iof, render: (a) => fmtNum(a.irHoje + a.pos.iof) },
    {
      key: "eco",
      header: "Economia de IR ao aguardar",
      align: "right",
      value: (a) => a.economiaIR,
      render: (a) => (a.economiaIR > 0 ? <span className="text-positive font-semibold">{fmtNum(a.economiaIR)}</span> : <span className="text-label">–</span>),
    },
    {
      key: "adic",
      header: "Líquido adicional até a faixa",
      align: "right",
      headerTitle: "Rendimento líquido adicional estimado (CDI das Premissas) até a data da próxima faixa",
      value: (a) => a.rendimentoAdicional,
      render: (a) => (a.rendimentoAdicional > 0 ? fmtNum(a.rendimentoAdicional) : <span className="text-label">–</span>),
    },
  ];

  const exportar = () =>
    exportarExcel(
      `R04_Eficiencia_Fiscal_${p.dataBase}.xlsx`,
      [
        {
          nome: "R04 - Prazo fiscal",
          titulo: "R04 – Eficiência fiscal por prazo",
          subtitulo: ESCOPOS.find((e) => e.value === escopo)!.label,
          colunas: [
            { titulo: "Transação", largura: 12 },
            { titulo: "Produto", largura: 16 },
            { titulo: "Parceiro de Negócio", largura: 26 },
            { titulo: "Data aplicação", tipo: "data", largura: 14 },
            { titulo: "Dias corridos", tipo: "inteiro" },
            { titulo: "Alíquota IR atual", tipo: "pct" },
            { titulo: "Alíquota IOF", tipo: "pct" },
            { titulo: "Próxima alíquota", tipo: "pct" },
            { titulo: "Dias até próxima faixa", tipo: "inteiro" },
            { titulo: "Data próxima faixa", tipo: "data", largura: 14 },
            { titulo: "Rendimento apropriado", tipo: "moeda" },
            { titulo: "IR + IOF se resgatar hoje", tipo: "moeda" },
            { titulo: "Economia de IR ao aguardar", tipo: "moeda" },
            { titulo: "Líquido adicional até a faixa", tipo: "moeda" },
            { titulo: "Recomendação", largura: 24 },
          ],
          linhas: linhas.map((a) => [
            a.pos.op.transacao,
            a.pos.op.produto,
            a.pos.op.contraparte,
            a.pos.op.dataAplicacao,
            a.pos.diasCorridos,
            a.pos.aliqIR,
            a.pos.aliqIOF,
            a.proxima?.aliquota ?? "",
            a.diasAteProxima ?? "",
            a.dataProxima ?? "",
            a.pos.rendimento,
            a.irHoje + a.pos.iof,
            a.economiaIR,
            a.rendimentoAdicional > 0 ? a.rendimentoAdicional : 0,
            a.recomendacao,
          ]),
          notas: [`Projeções com CDI de ${fmtPct(p.cdi)} a.a. (Premissas). Economia = (alíquota atual − próxima) × rendimento já apropriado.`],
        },
      ],
      p.dataBase,
    );

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Aguardar próxima faixa" value={String(aguardar.length)} state={aguardar.length ? "critical" : "positive"} sub="≤ 45 dias para a mudança" />
          <HeaderKpi label="Em período de IOF" value={String(iof.length)} state={iof.length ? "negative" : "positive"} sub="aplicadas há < 30 dias" />
          <HeaderKpi label="Economia potencial de IR" value={fmtCompact(aguardar.reduce((s, a) => s + a.economiaIR, 0))} state="positive" />
          <HeaderKpi label="Alíquota média de IR" value={fmtPct(aliqMedia, 1)} sub="ponderada pelo rendimento" />
        </>
      }
    >
      <div className="bg-surface rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <FilterField label="Empresa">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
          </FilterField>
          <FilterField label="Recomendação">
            <Select
              value={filtro}
              onChange={setFiltro}
              options={[{ value: TODAS, label: "Todas" }, ...(Object.keys(REC_STATE) as Recomendacao[]).map((r) => ({ value: r, label: `${r} (${analises.filter((a) => a.recomendacao === r).length})` }))]}
            />
          </FilterField>
          <div className="text-[13px] text-label sm:text-right">Projeções com CDI de {fmtPct(p.cdi)} a.a. (Premissas)</div>
        </div>
      </div>

      <Card title={`Faixa do IRRF por aplicação (${linhas.length})`} subtitle="Tabela regressiva (Lei 11.033/2004) contada em dias corridos desde a aplicação" bodyClassName="px-0 pb-0">
        <DataTable columns={colunas} rows={linhas} rowKey={(a) => a.pos.op.transacao} defaultSort={{ key: "prox", dir: "asc" }} maxHeight={560} />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card title="Carteira por faixa de IR" subtitle="Saldo bruto e quantidade de operações">
          <ul className="space-y-3">
            {faixas.map((f) => (
              <li key={f.rotulo}>
                <div className="flex items-center justify-between text-[13px] mb-1">
                  <span className="text-text font-semibold">{f.rotulo}</span>
                  <span className="tabular text-label">
                    {fmtCompact(f.valor)} · {f.qtd}
                  </span>
                </div>
                <MicroBar value={f.valor} max={maxFaixa} color={f.fixo ? "#a462a6" : f.aliq > 0.2 ? "#ffa436" : f.aliq > 0.15 ? "#5e9454" : "#009994"} className="h-2" />
              </li>
            ))}
          </ul>
        </Card>
        <Simulador cdi={p.cdi} className="xl:col-span-2" />
      </div>

      <MessageStrip>
        Economia de IR ao aguardar = (alíquota atual − alíquota da próxima faixa) × rendimento já apropriado. O “líquido
        adicional” soma o rendimento projetado até a data da próxima faixa, já líquido do IR menor. Aplicações que vencem
        antes da próxima faixa não entram no cálculo.
      </MessageStrip>
    </ReportPage>
  );
}

const MARCOS = [1, 15, 29, 30, 180, 181, 360, 361, 720, 721];

function Simulador({ cdi, className }: { cdi: number; className?: string }) {
  const [valor, setValor] = useState(1_000_000);
  const [pct, setPct] = useState(100);
  const [prazo, setPrazo] = useState(365);
  const serie = useMemo(() => simularCargaTributaria(pct / 100, cdi, 900), [pct, cdi]);
  const ponto = serie[Math.min(prazo, serie.length) - 1];
  const bruto = valor * (Math.pow(1 + (Math.pow(1 + cdi, 1 / 365) - 1) * (pct / 100), prazo) - 1);
  const iofV = bruto * aliquotaIOF(prazo);
  const irV = (bruto - iofV) * aliquotaIR(prazo, "Regressivo");

  return (
    <Card className={className} title="Simulação de carga tributária por prazo" subtitle="Aplicação pós-fixada em % do CDI · IR regressivo + IOF" icon={<Calculator className="w-5 h-5 text-link" />}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FilterField label="Valor aplicado (R$)">
          <NumberInput value={valor} onChange={setValor} step={100000} min={0} suffix="R$" />
        </FilterField>
        <FilterField label="Taxa (% do CDI)">
          <NumberInput value={pct} onChange={setPct} step={1} min={50} max={150} suffix="% CDI" />
        </FilterField>
        <FilterField label={`Prazo: ${prazo} dias`}>
          <input type="range" min={1} max={900} value={prazo} onChange={(e) => setPrazo(Number(e.target.value))} className="w-full h-9 accent-brand" aria-label="Prazo em dias" />
        </FilterField>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
        <Resultado label="Rendimento bruto" valor={fmtBRL(bruto)} />
        <Resultado label={`IOF (${fmtPct(aliquotaIOF(prazo), 0)})`} valor={fmtBRL(iofV)} />
        <Resultado label={`IR (${fmtPct(aliquotaIR(prazo, "Regressivo"), 1)})`} valor={fmtBRL(irV)} />
        <Resultado label="Rendimento líquido" valor={fmtBRL(bruto - iofV - irV)} destaque />
        <Resultado label="% CDI líquido" valor={`${fmtDec(ponto.pctCDILiquido * 100, 1)}%`} destaque />
      </div>

      <div className="h-64 mt-4 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={serie.filter((s) => s.dias <= 900)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#3f3f3d" />
            <XAxis dataKey="dias" type="number" domain={[1, 900]} ticks={[30, 180, 360, 720, 900]} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#575653" }} />
            <YAxis yAxisId="c" tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} unit="%" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
            <YAxis yAxisId="l" orientation="right" tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} unit="%" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(l) => `${l} dias`}
              formatter={(v: number, n: string) => [`${fmtDec(v, 1)}%`, n]}
            />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Figtree, system-ui, sans-serif" }} iconType="circle" iconSize={8} />
            <ReferenceLine yAxisId="c" x={prazo} stroke="#009994" strokeDasharray="4 4" />
            <Line yAxisId="c" type="stepAfter" dataKey={(d: { carga: number }) => d.carga * 100} name="Carga tributária s/ rendimento" stroke="#ffa436" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line yAxisId="l" type="monotone" dataKey={(d: { pctCDILiquido: number }) => d.pctCDILiquido * 100} name="% CDI líquido" stroke="#009994" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto fiori-scroll mt-3">
        <table className="w-full text-[13px] min-w-[560px]">
          <thead>
            <tr className="text-label">
              <th className="text-left font-normal py-1">Dias</th>
              {MARCOS.map((m) => (
                <th key={m} className="text-right text-text py-1 tabular">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line-soft">
              <td className="py-1 text-label">Carga</td>
              {MARCOS.map((m) => (
                <td key={m} className="text-right tabular py-1">
                  {fmtDec(serie[m - 1].carga * 100, 1)}%
                </td>
              ))}
            </tr>
            <tr className="border-t border-line-soft">
              <td className="py-1 text-label">% CDI líq.</td>
              {MARCOS.map((m) => (
                <td key={m} className="text-right tabular py-1">
                  {fmtDec(serie[m - 1].pctCDILiquido * 100, 1)}%
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Resultado({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-3 px-3 py-2 min-w-0">
      <div className="text-xs text-label truncate">{label}</div>
      <div className={destaque ? "text-base font-bold text-positive tabular truncate" : "text-base font-semibold text-text tabular truncate"}>{valor}</div>
    </div>
  );
}
