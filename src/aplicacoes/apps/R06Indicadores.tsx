import { useMemo, type ReactNode } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { AXIS_STYLE, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, semaforoState, Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";
import { CONTRATOS, GRUPO_MODALIDADE } from "../../captacoes/data/contratos";
import { indicadoresEm, reclassificadosEm } from "../../captacoes/lib/covenants";
import { custoMedioPonderado, posicoesDivida, type PosicaoDivida } from "../../captacoes/lib/divida";
import { usePremissas } from "../../shared/context/MercadoContext";
import { fmtDate, fmtQuarter } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { contratosMestre } from "../lib/carteiraMestre";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct, fmtX, plural } from "../../shared/lib/format";
import {
  apurarCovenants,
  avaliarLimitesPolitica,
  calcularCarry,
  endividamentoEm,
  exposicaoCambial,
  fmtFolgaCovenant,
  fmtLimiteCovenant,
  fmtValorCovenant,
  indicadoresTrimestre,
  rotuloApuracao,
  rotuloCovenant,
  SEMAFORO_TEXTO,
  trimestresAte,
  type ApuracaoCovenant,
  type IndicadoresTrimestre,
} from "../lib/indicadores";

const rel = relatorioPorId("r06");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

const SERIE: { rotulo: string; formula?: string; v: (i: IndicadoresTrimestre) => number; tipo: "valor" | "x" }[] = [
  { rotulo: "Dívida bruta", v: (i) => i.dividaBruta, tipo: "valor" },
  { rotulo: "(−) Caixa", v: (i) => i.caixa, tipo: "valor" },
  { rotulo: "(−) Aplicações financeiras (valor contábil)", v: (i) => i.aplicacoes, tipo: "valor" },
  { rotulo: "Dívida líquida", v: (i) => i.dividaLiquida, tipo: "valor" },
  { rotulo: "EBITDA (12 meses)", v: (i) => i.ebitdaLTM, tipo: "valor" },
  { rotulo: "Encargos da dívida (12 meses)", v: (i) => i.encargosLTM, tipo: "valor" },
  { rotulo: "Patrimônio líquido", v: (i) => i.patrimonioLiquido, tipo: "valor" },
  { rotulo: "DL / EBITDA", v: (i) => i.dlEbitda, tipo: "x" },
  { rotulo: "Cobertura de juros", formula: "EBITDA ÷ encargos da dívida (12 meses)", v: (i) => i.cobertura, tipo: "x" },
  { rotulo: "Cobertura de curto prazo", formula: "(caixa + aplicações circulantes) ÷ dívida circulante", v: (i) => i.liquidezCP, tipo: "x" },
  { rotulo: "DL / PL", v: (i) => i.dlPl, tipo: "x" },
];

/** Nome exibido dos limites da política (a liquidez de curto prazo é a "Cobertura de curto prazo", como nos KPIs) */
const NOME_LIMITE: Record<string, string> = { liquidez: "Cobertura de curto prazo" };
const nomeLimite = (c: { id: string; indicador: string }) => NOME_LIMITE[c.id] ?? c.indicador;

/** "A, B e C" */
function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** Nome em frases (o ICSD já é a sigla consagrada) */
function nomeCovenant(a: ApuracaoCovenant): string {
  return a.cov.id === "icsd" ? "ICSD" : a.cov.indicador;
}

export function R06Indicadores() {
  const { premissas: p } = usePremissas();
  const db = p.dataBase;

  const d = useMemo(() => {
    const serie = trimestresAte(db).map((t) => indicadoresTrimestre(t));
    const trimestre = serie[serie.length - 1];
    const mestre = contratosMestre(db, p);
    const carry = calcularCarry(mestre, p);
    const cambiais = mestre.filter(exposicaoCambial);
    const dividas = composicaoDivida(posicoesDivida(CONTRATOS, db, p, reclassificadosEm(db)));
    const na = endividamentoEm(p);
    const covenants = apurarCovenants(db);
    const politica = avaliarLimitesPolitica(trimestre);
    // dívida líquida da apuração do covenant DL/EBITDA (fim de trimestre) – difere da data-base fora de fim de trimestre
    const apDl = covenants.find((a) => a.cov.id === "dlEbitda")?.dataApuracao ?? null;
    const dlApuracao = apDl ? indicadoresEm(apDl).dividaLiquida : null;
    return { serie, trimestre, carry, cambiais, dividas, na, covenants, politica, dlApuracao };
  }, [db, p]);

  const { trimestre, carry, cambiais, dividas, na, covenants, politica, dlApuracao } = d;
  const totalDivida = dividas.reduce((s, x) => s + x.circulante + x.naoCirculante, 0);
  const covDl = covenants.find((a) => a.cov.id === "dlEbitda")!;
  const cumpridos = covenants.filter((a) => a.dataApuracao && a.status !== "excedido").length;
  const descumpridos = covenants.filter((a) => a.status === "excedido");
  const semWaiver = descumpridos.filter((a) => a.reclassifica);
  const emAtencao = covenants.filter((a) => a.status === "atencao");
  const caixaNaData = na.dataCaixa === db;
  const caixaAnterior = !!na.dataCaixa && !caixaNaData;
  // exposição cambial fora do carry: time deposits e fundos cambiais (taxa em moeda estrangeira)
  const nTD = cambiais.filter((c) => c.tipo === "Time deposit").length;
  const nFundoCambial = cambiais.filter((c) => c.tipo === "Fundo de investimento").length;
  const descCambial = [nTD ? plural(nTD, "time deposit", "time deposits") : "", nFundoCambial ? plural(nFundoCambial, "fundo cambial", "fundos cambiais") : ""]
    .filter(Boolean)
    .join(" e ");

  const exportar = () =>
    exportarExcel(
      `R06_Endividamento_x_Aplicacoes_${db}.xlsx`,
      [
        {
          nome: "Na data-base",
          titulo: `R06 – Endividamento × Aplicações na data-base (${fmtDate(db)})`,
          subtitulo: "Consolidado · valores em R$",
          colunas: [{ titulo: "Item", largura: 52 }, { titulo: "Valor", tipo: "moeda", largura: 20 }],
          linhas: [
            ["Dívida bruta (custo amortizado)", na.dividaBruta],
            ["  Circulante", na.dividaCirculante],
            ["  Não circulante", na.dividaNaoCirculante],
            ...(na.reclassificado > 0 ? [[`  Reclassificado para o circulante – CPC 26.74 (${na.idsReclassificados.join(", ")})`, na.reclassificado]] : []),
            [`(−) Caixa${na.dataCaixa && !caixaNaData ? ` (último balancete: ${fmtDate(na.dataCaixa)})` : ""}`, na.caixa],
            ["(−) Aplicações financeiras (valor contábil)", na.aplicacoesContabil],
            ["Dívida líquida", na.dividaLiquida],
          ],
          notas: [
            "Dívida e aplicações na data-base; caixa do último balancete trimestral disponível até a data-base (dado corporativo fictício).",
            ...(covDl.dataApuracao !== db && dlApuracao !== null
              ? [`O covenant DL/EBITDA usa a apuração de ${rotuloApuracao(covDl)} (dívida líquida de ${fmtBRL(dlApuracao)}), não a dívida líquida da data-base.`]
              : []),
          ],
        },
        {
          nome: "Série trimestral",
          titulo: "R06 – Endividamento × Aplicações: série trimestral",
          subtitulo: "Consolidado · fim de cada trimestre",
          colunas: [{ titulo: "Indicador", largura: 44 }, ...d.serie.map((i) => ({ titulo: fmtQuarter(i.data), tipo: "decimal" as const, largura: 16 }))],
          linhas: SERIE.map((s) => [s.formula ? `${s.rotulo} (${s.formula})` : s.rotulo, ...d.serie.map((i) => s.v(i))]),
          notas: ["Valores em R$; indicadores em múltiplos (x). Aplicações pelo valor contábil."],
        },
        {
          nome: "Covenants contratuais",
          titulo: `R06 – Covenants contratuais (última apuração até ${fmtDate(db)})`,
          subtitulo: "Mesma apuração da carteira de captações (dívida)",
          colunas: [
            { titulo: "Indicador", largura: 36 },
            { titulo: "Unidade", largura: 9 },
            { titulo: "Tipo de limite", largura: 13 },
            { titulo: "Limite", tipo: "decimal", largura: 10 },
            { titulo: "Apuração", tipo: "data", largura: 13 },
            { titulo: "Valor apurado", tipo: "decimal", largura: 13 },
            { titulo: "Folga", tipo: "decimal", largura: 10 },
            { titulo: "Status", largura: 20 },
            { titulo: "Waiver", largura: 30 },
            { titulo: "Efeito CPC 26", largura: 30 },
            { titulo: "Contratos", largura: 24 },
          ],
          linhas: covenants.map((a) => {
            const esc = a.cov.formato === "pct" ? 100 : 1;
            return [
              a.cov.indicador,
              a.cov.formato === "pct" ? "%" : "x",
              a.cov.tipo === "max" ? "Máximo" : "Mínimo",
              a.cov.limite * esc,
              a.dataApuracao,
              a.valor * esc,
              a.folga * esc,
              rotuloCovenant(a).texto,
              a.waiver ? `${a.waiver.credor} em ${fmtDate(a.waiver.obtidoEm)}${a.waiverVigente ? " (vigente)" : " (após a data-base)"}` : "",
              a.reclassifica ? "Reclassifica o não circulante para o circulante" : "Não reclassifica",
              a.cov.contratos.join(", "),
            ];
          }),
          notas: [
            "CPC 26, item 74: descumprimento na data do balanço sem waiver obtido até essa data – passivo do contrato classificado no circulante.",
            "CPC 26, item 76 / CPC 24: waiver obtido após a data do balanço é evento subsequente que não origina ajuste; apenas divulgação.",
          ],
        },
        {
          nome: "Política financeira",
          titulo: `R06 – Limites da política financeira interna (apuração ${fmtQuarter(trimestre.data)})`,
          colunas: [{ titulo: "Indicador", largura: 30 }, { titulo: "Tipo", largura: 10 }, { titulo: "Limite", tipo: "decimal" }, { titulo: "Valor", tipo: "decimal" }, { titulo: "Status", largura: 16 }, { titulo: "Fonte", largura: 30 }],
          linhas: politica.map((c) => [nomeLimite(c), c.tipo === "max" ? "Máximo" : "Mínimo", c.limite, c.valor, SEMAFORO_TEXTO[c.status], c.fonte]),
        },
        {
          nome: "Carry",
          titulo: `R06 – Carry: rentabilidade das aplicações × custo da dívida (${fmtDate(db)})`,
          colunas: [{ titulo: "Item", largura: 52 }, { titulo: "Valor", tipo: "decimal", largura: 18 }],
          linhas: [
            ["Saldo bruto das aplicações em R$ na data-base – base do carry (R$)", carry.saldo],
            ["Taxa bruta média ponderada (% a.a.)", carry.taxaBruta * 100],
            ["Alíquota média de IR (%)", carry.aliquotaMediaIR * 100],
            ["Taxa líquida média (% a.a.)", carry.taxaLiquida * 100],
            ["Custo médio ponderado da dívida (% a.a.)", carry.custoDivida * 100],
            ["Carry bruto (p.p.)", carry.carryBruto * 100],
            ["Ganho (+) / custo (−) de carregamento (R$ a.a.)", carry.custoCarregamento],
            [`Exposição cambial fora do carry${descCambial ? ` – ${descCambial}` : ""} (R$)`, carry.saldoCambial],
          ],
          notas: [
            "Carry só com as aplicações em R$ (saldo bruto: curva na renda fixa e nos títulos, valor da cota nos fundos): a taxa dos time deposits e dos fundos cambiais, em moeda estrangeira e sem a variação cambial, não é comparável ao custo da dívida em R$.",
          ],
        },
        {
          nome: "Dívida",
          titulo: `Composição de empréstimos e financiamentos (${fmtDate(db)})`,
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
          notas: [
            "Carteira de captações (dívida) do mesmo ambiente SAP, pelo custo amortizado na data-base.",
            ...(na.reclassificado > 0 ? [`Circulante inclui ${fmtBRL(na.reclassificado)} de ${na.idsReclassificados.join(", ")} reclassificados do não circulante (CPC 26, item 74).`] : []),
          ],
        },
      ],
      db,
    );

  const grafico = d.serie.map((i) => ({
    tri: fmtQuarter(i.data),
    divida: i.dividaBruta / 1e6,
    caixa: i.caixaTotal / 1e6,
    dl: i.dividaLiquida / 1e6,
    dlEbitda: i.dlEbitda,
  }));
  const maxTaxa = Math.max(carry.taxaBruta, carry.custoDivida) * 1.1;

  // Nota CPC 26 (reclassificação / waiver) na data-base
  const caso = covenants.find((a) => a.reclassifica) ?? covenants.find((a) => a.status === "excedido" && a.waiverVigente) ?? null;
  let faixa: ReactNode = null;
  if (caso?.reclassifica) {
    faixa = (
      <MessageStrip design="negative">
        <strong>{nomeCovenant(caso)}</strong> {caso.cov.periodicidade === "Anual" ? `do exercício ${caso.dataApuracao!.slice(0, 4)}` : `de ${fmtQuarter(caso.dataApuracao!)}`} apurado em{" "}
        <strong>{fmtValorCovenant(caso.cov, caso.valor)}</strong> ({caso.cov.tipo === "max" ? "máximo" : "mínimo"} {fmtLimiteCovenant(caso.cov).slice(2)}) sem
        waiver até a data do balanço: o não circulante de {listar(na.idsReclassificados)} (<strong>{fmtCompact(na.reclassificado)}</strong>) foi reclassificado
        para o circulante (CPC 26, item 74) – a dívida circulante e a composição abaixo já refletem a reclassificação.
        {caso.waiver && ` O waiver do ${caso.waiver.credor}, obtido em ${fmtDate(caso.waiver.obtidoEm)}, é evento subsequente que não origina ajuste (CPC 24).`}
      </MessageStrip>
    );
  } else if (caso?.waiver) {
    faixa = (
      <MessageStrip design="information">
        {nomeCovenant(caso)} {caso.cov.periodicidade === "Anual" ? `do exercício ${caso.dataApuracao!.slice(0, 4)}` : `de ${fmtQuarter(caso.dataApuracao!)}`} (
        {fmtValorCovenant(caso.cov, caso.valor)}) {caso.cov.tipo === "max" ? "acima do máximo" : "abaixo do mínimo"} de {fmtLimiteCovenant(caso.cov).slice(2)}, com{" "}
        <strong>
          waiver do {caso.waiver.credor} obtido em {fmtDate(caso.waiver.obtidoEm)}
        </strong>
        : sem vencimento antecipado, {listar(caso.cov.contratos)} seguem o cronograma contratual na data-base. No balanço de{" "}
        {fmtDate(caso.dataApuracao)}, sem waiver até aquela data, o não circulante desses contratos foi reclassificado para o circulante (CPC 26, item 74).
      </MessageStrip>
    );
  } else if (emAtencao.length) {
    faixa = (
      <MessageStrip design="critical">
        {listar(emAtencao.map((a) => a.cov.indicador))} na faixa de atenção: folga reduzida em relação ao limite contratual.
      </MessageStrip>
    );
  }

  const estadoCov = semWaiver.length ? "negative" : descumpridos.length || emAtencao.length ? "critical" : "positive";

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <>
          <HeaderKpi label="Dívida bruta" value={fmtCompact(na.dividaBruta)} sub={`em ${fmtDate(db)} · custo amortizado`} />
          <HeaderKpi
            label={caixaAnterior ? "Dívida líquida na data-base" : "Dívida líquida"}
            value={fmtCompact(na.dividaLiquida)}
            sub={`${caixaAnterior ? `caixa de ${fmtDate(na.dataCaixa)} · ` : ""}caixa + aplic. ${fmtCompact(na.caixa + na.aplicacoesContabil)}`}
          />
          <HeaderKpi
            label="DL / EBITDA"
            value={fmtX(covDl.valor)}
            state={rotuloCovenant(covDl).state}
            sub={`apuração ${rotuloApuracao(covDl)}${dlApuracao !== null && covDl.dataApuracao !== db ? `: DL ${fmtCompact(dlApuracao)}` : ""} · covenant ${fmtLimiteCovenant(covDl.cov)}`}
          />
          <HeaderKpi
            label="Covenants contratuais"
            value={`${cumpridos}/${covenants.length}`}
            state={estadoCov}
            sub={
              descumpridos.length
                ? `${listar(descumpridos.map(nomeCovenant))} ${semWaiver.length ? "descumprido" : "com waiver"}`
                : emAtencao.length
                  ? `${emAtencao.length} em atenção`
                  : "cumpridos na última apuração"
            }
          />
          <HeaderKpi label="Carry" value={`${fmtDec(carry.carryBruto * 100, 2)} p.p.`} state={carry.carryBruto >= 0 ? "positive" : "negative"} sub={`aplicações em R$ · ${fmtCompact(carry.custoCarregamento)}/ano`} />
        </>
      }
    >
      {faixa}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <Card
          className="xl:col-span-3"
          title="Dívida bruta × caixa e aplicações"
          subtitle="Fim de cada trimestre · R$ milhões (barras) e DL/EBITDA (linha) · aplicações pelo valor contábil"
        >
          <div className="h-72 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={grafico} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="tri" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} />
                <YAxis yAxisId="v" tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="x" orientation="right" domain={[0, 3.5]} ticks={[0, 1, 2, 3]} tickFormatter={(v: number) => `${v}x`} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={36} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => (n === "DL / EBITDA" ? [fmtX(v), n] : [`R$ ${fmtDec(v, 1)} mi`, n])} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <ReferenceLine yAxisId="x" y={covDl.cov.limite} stroke="#f53232" strokeDasharray="4 4" label={{ value: `Covenant ${fmtX(covDl.cov.limite, 1)}`, fill: "#aa0808", fontSize: 11, position: "insideTopRight" }} />
                <Bar yAxisId="v" dataKey="divida" name="Dívida bruta" fill="#df1278" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar yAxisId="v" dataKey="caixa" name="Caixa + aplicações" fill="#168eff" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="x" dataKey="dlEbitda" name="DL / EBITDA" stroke="#1d2d3e" strokeWidth={2.5} dot={{ r: 3.5, fill: "#1d2d3e" }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="xl:col-span-2" title="Carry" subtitle={`Rentabilidade das aplicações em R$ − custo da dívida (a.a.) · data-base ${fmtDate(db)}`}>
          <div className="space-y-3 mt-1">
            <BarraTaxa rotulo="Aplicações em R$ – taxa bruta média" valor={carry.taxaBruta} max={maxTaxa} cor="#168eff" />
            <BarraTaxa rotulo={`Aplicações em R$ – taxa líquida (IR ${fmtPct(carry.aliquotaMediaIR, 1)})`} valor={carry.taxaLiquida} max={maxTaxa} cor="#75980b" />
            <BarraTaxa rotulo="Custo médio ponderado da dívida" valor={carry.custoDivida} max={maxTaxa} cor="#df1278" />
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
          {carry.saldoCambial > 0.5 && (
            <p className="text-[13px] text-text mt-3 leading-snug">
              Exposição cambial fora do carry: <strong className="tabular">{fmtCompact(carry.saldoCambial)}</strong>{" "}
              <span className="text-label">
                ({descCambial || "aplicações em moeda estrangeira"} – taxa em moeda estrangeira não comparável ao custo em R$)
              </span>
            </p>
          )}
          <p className="text-xs text-label mt-3 leading-relaxed">
            Manter {fmtCompact(carry.saldo)} aplicados em R$ (saldo bruto em {fmtDate(db)}) enquanto a dívida custa {fmtPct(carry.custoDivida)} a.a.
            gera um carry {carry.carryBruto >= 0 ? "positivo" : "negativo"} de {fmtDec(carry.carryBruto * 100, 2)} p.p.{" "}
            {carry.carryBruto >= 0
              ? "As aplicações rendem acima do custo médio da dívida: mantenha a liquidez e renegocie as dívidas mais caras quando houver oportunidade."
              : "Avalie o pré-pagamento das dívidas mais caras × a necessidade de liquidez."}
          </p>
        </Card>
      </div>

      <CardCovenants covenants={covenants} dataBase={db} />

      <Card
        title="Limites da política financeira interna"
        subtitle={`Apuração ${fmtQuarter(trimestre.data)} (${fmtDate(trimestre.data)}) · limites internos da tesouraria, não são covenants contratuais`}
        bodyClassName="px-0 pb-0"
      >
        <div className="hidden lg:block">
          <DataTable
            columns={[
              {
                key: "ind",
                header: "Indicador",
                minWidth: 180,
                value: (c) => nomeLimite(c),
                render: (c) => (
                  <div className="leading-snug">
                    <div className="font-semibold">{nomeLimite(c)}</div>
                    <div className="text-xs text-label">{c.formula}</div>
                  </div>
                ),
              },
              { key: "lim", header: "Limite", align: "right", value: (c) => c.limite, render: (c) => `${c.tipo === "max" ? "≤" : "≥"} ${fmtX(c.limite)}` },
              { key: "val", header: `Valor ${fmtQuarter(trimestre.data)}`, align: "right", value: (c) => c.valor, render: (c) => <span className="font-bold">{fmtX(c.valor)}</span> },
              {
                key: "folga",
                header: "Folga",
                align: "right",
                value: (c) => c.folga,
                render: (c) => <span className={c.folga >= 0 ? "text-positive" : "text-negative"}>{c.folga < 0 ? "−" : ""}{fmtX(Math.abs(c.folga))}</span>,
              },
              { key: "st", header: "Status", value: (c) => c.status, render: (c) => <ObjectStatus state={semaforoState(c.status)}>{SEMAFORO_TEXTO[c.status]}</ObjectStatus> },
              { key: "fonte", header: "Fonte", value: (c) => c.fonte, render: (c) => <span className="text-label">{c.fonte}</span> },
            ]}
            rows={politica}
            rowKey={(c) => c.id}
          />
        </div>
        <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
          {politica.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text">{nomeLimite(c)}</div>
                  <div className="text-xs text-label leading-snug mt-0.5">{c.formula}</div>
                </div>
                <div className="shrink-0">
                  <ObjectStatus state={semaforoState(c.status)}>{SEMAFORO_TEXTO[c.status]}</ObjectStatus>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-x-4 gap-y-2 mt-2.5 text-[13px]">
                <PopIn rotulo={`Valor ${fmtQuarter(trimestre.data)}`} valor={fmtX(c.valor)} />
                <PopIn rotulo="Limite" valor={`${c.tipo === "max" ? "≤" : "≥"} ${fmtX(c.limite)}`} />
                <PopIn rotulo="Folga" valor={<span className={c.folga >= 0 ? "text-positive" : "text-negative"}>{fmtX(c.folga)}</span>} />
              </dl>
              <div className="text-xs text-label mt-2">{c.fonte}</div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Série trimestral" subtitle="Fim de cada trimestre · valores em R$ · indicadores em múltiplos · aplicações pelo valor contábil" bodyClassName="px-0 pb-0">
        <div className="overflow-x-auto fiori-scroll">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-[1] bg-white text-left pl-4 pr-3 py-2.5 font-semibold text-[13px] border-b border-[#a8b2bd] min-w-[150px] sm:min-w-[260px]">Indicador</th>
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
                  <td className="sticky left-0 z-[1] bg-white pl-4 pr-3 py-2 border-b border-line-soft max-w-[170px] sm:max-w-none">
                    <div className="sm:whitespace-nowrap leading-snug">{s.rotulo}</div>
                    {s.formula && <div className="text-xs text-label font-normal leading-snug">{s.formula}</div>}
                  </td>
                  {d.serie.map((i) => (
                    <td key={i.data} className="px-3 py-2 text-right tabular border-b border-line-soft whitespace-nowrap">
                      {s.tipo === "x" ? fmtX(s.v(i)) : fmtNum(s.v(i))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Composição da dívida"
        subtitle={`Total ${fmtBRL(totalDivida)} em ${fmtDate(db)} pelo custo amortizado · carteira de captações (dívida)${
          na.reclassificado > 0 ? ` · circulante inclui ${fmtCompact(na.reclassificado)} reclassificados (CPC 26.74)` : ""
        }`}
        bodyClassName="px-0 pb-0"
      >
        <div className="hidden lg:block">
          <DataTable<LinhaDivida>
            columns={[
              { key: "mod", header: "Modalidade", value: (x) => x.modalidade, render: (x) => <span className="font-semibold">{x.modalidade}</span>, total: () => "Total" },
              { key: "qtd", header: "Contratos", align: "right", value: (x) => x.contratos, total: (r) => String(r.reduce((s, x) => s + x.contratos, 0)) },
              { key: "cp", header: "Circulante", align: "right", value: (x) => x.circulante, render: (x) => fmtNum(x.circulante, { dash: true }), total: (r) => fmtNum(r.reduce((s, x) => s + x.circulante, 0)) },
              { key: "lp", header: "Não circulante", align: "right", value: (x) => x.naoCirculante, render: (x) => fmtNum(x.naoCirculante, { dash: true }), total: (r) => fmtNum(r.reduce((s, x) => s + x.naoCirculante, 0)) },
              { key: "tot", header: "Total", align: "right", value: (x) => x.circulante + x.naoCirculante, render: (x) => <span className="font-semibold">{fmtNum(x.circulante + x.naoCirculante)}</span>, total: (r) => fmtNum(r.reduce((s, x) => s + x.circulante + x.naoCirculante, 0)) },
              { key: "taxa", header: "Taxa efetiva média", align: "right", value: (x) => x.taxa, render: (x) => `${fmtPct(x.taxa)} a.a.`, total: () => `${fmtPct(carry.custoDivida)} a.a.` },
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
              { key: "venc", header: "Vencimento final", align: "right", value: (x) => x.vencimento, render: (x) => fmtDate(x.vencimento) },
            ]}
            rows={dividas}
            rowKey={(x) => x.modalidade}
            showTotals
            defaultSort={{ key: "tot", dir: "desc" }}
          />
        </div>
        <ul className="lg:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
          {[...dividas]
            .sort((a, b) => b.circulante + b.naoCirculante - (a.circulante + a.naoCirculante))
            .map((x) => (
              <li key={x.modalidade} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text">{x.modalidade}</div>
                    <div className="text-xs text-label leading-snug mt-0.5">
                      {plural(x.contratos, "contrato", "contratos")} · {x.indexadores} · {fmtPct(x.taxa)} a.a. · vencimento final {fmtDate(x.vencimento)}
                    </div>
                  </div>
                  <span className="text-sm font-bold tabular text-text whitespace-nowrap">{fmtNum(x.circulante + x.naoCirculante)}</span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2.5 text-[13px]">
                  <PopIn rotulo="Circulante" valor={fmtNum(x.circulante, { dash: true })} />
                  <PopIn rotulo="Não circulante" valor={fmtNum(x.naoCirculante, { dash: true })} />
                </dl>
              </li>
            ))}
          <li className="px-4 py-3 bg-[#f5f6f7]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-text">Total</div>
                <div className="text-xs text-label leading-snug mt-0.5">
                  {plural(dividas.reduce((s, x) => s + x.contratos, 0), "contrato", "contratos")} · custo médio {fmtPct(carry.custoDivida)} a.a.
                </div>
              </div>
              <span className="text-sm font-bold tabular text-text whitespace-nowrap">{fmtNum(totalDivida)}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2.5 text-[13px]">
              <PopIn rotulo="Circulante" valor={fmtNum(dividas.reduce((s, x) => s + x.circulante, 0))} />
              <PopIn rotulo="Não circulante" valor={fmtNum(dividas.reduce((s, x) => s + x.naoCirculante, 0))} />
            </dl>
          </li>
        </ul>
      </Card>

      <MessageStrip>
        Cabeçalho, carry e composição da dívida na data-base ({fmtDate(db)}); série trimestral, covenants e limites da política
        na última apuração de cada indicador. Aplicações financeiras calculadas a partir da Carteira-Mestre (renda fixa, títulos
        públicos, fundos e time deposits), pelo valor contábil, em cada data; o carry usa o saldo bruto das aplicações em R$.
        Dívida, encargos, custo médio ponderado e apuração dos covenants vêm da carteira de captações (dívida) do mesmo
        ambiente SAP; caixa, EBITDA e PL são dados corporativos fictícios do ambiente de teste (balancetes trimestrais)
        {na.dataCaixa && !caixaNaData ? ` – na data-base usa-se o caixa de ${fmtDate(na.dataCaixa)}` : ""}.
      </MessageStrip>
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Covenants contratuais
// ---------------------------------------------------------------------------

function CelulaWaiver({ a }: { a: ApuracaoCovenant }) {
  if (!a.waiver) return <span className="text-label">—</span>;
  return (
    <div className="leading-snug whitespace-nowrap">
      <div className="font-semibold text-text">{a.waiver.credor}</div>
      <div className="text-xs text-label tabular">{fmtDate(a.waiver.obtidoEm)}</div>
      <div className={`text-xs ${a.waiverVigente ? "text-positive" : "text-critical"}`}>{a.waiverVigente ? "vigente" : "após o balanço"}</div>
    </div>
  );
}

function CelulaCPC26({ a }: { a: ApuracaoCovenant }) {
  if (a.reclassifica)
    return (
      <div className="leading-snug">
        <ObjectStatus state="negative">Reclassifica</ObjectStatus>
        <div className="text-xs text-label">NC → circulante (CPC 26.74)</div>
      </div>
    );
  return (
    <div className="leading-snug">
      <div className="text-[13px] text-text">Não reclassifica</div>
      {a.status === "excedido" && a.waiverVigente && <div className="text-xs text-label">waiver vigente</div>}
    </div>
  );
}

function CardCovenants({ covenants, dataBase }: { covenants: ApuracaoCovenant[]; dataBase: string }) {
  const colunas: Column<ApuracaoCovenant>[] = [
    {
      key: "ind",
      header: "Indicador",
      minWidth: 200,
      value: (a) => a.cov.indicador,
      render: (a) => (
        <div className="leading-snug" title={a.cov.formula}>
          <div className="font-semibold text-text">{a.cov.indicador}</div>
          <div className="text-xs text-label">
            {a.cov.contratos.join(", ")} · {a.cov.periodicidade.toLowerCase()}
          </div>
        </div>
      ),
    },
    { key: "lim", header: "Limite", align: "right", value: (a) => a.cov.limite, render: (a) => <span className="font-semibold">{fmtLimiteCovenant(a.cov)}</span> },
    {
      key: "apur",
      header: "Apuração",
      align: "right",
      value: (a) => a.dataApuracao,
      render: (a) => (
        <div className="leading-snug">
          <div>{rotuloApuracao(a)}</div>
          <div className="text-xs text-label">{fmtDate(a.dataApuracao)}</div>
        </div>
      ),
    },
    {
      key: "val",
      header: "Valor apurado",
      align: "right",
      value: (a) => a.valor,
      render: (a) => <span className={`font-bold ${a.status === "ok" ? "" : a.reclassifica ? "text-negative" : "text-critical"}`}>{fmtValorCovenant(a.cov, a.valor)}</span>,
    },
    {
      key: "folga",
      header: "Folga",
      align: "right",
      value: (a) => a.folga / a.cov.limite,
      render: (a) => <span className={a.folga >= 0 ? "text-positive" : "text-negative"}>{fmtFolgaCovenant(a.cov, a.folga)}</span>,
    },
    {
      key: "st",
      header: "Status",
      value: (a) => (a.status === "ok" ? 0 : a.status === "atencao" ? 1 : 2),
      render: (a) => {
        const r = rotuloCovenant(a);
        return <ObjectStatus state={r.state}>{r.texto}</ObjectStatus>;
      },
    },
    { key: "waiver", header: "Waiver", value: (a) => a.waiver?.obtidoEm ?? "", render: (a) => <CelulaWaiver a={a} /> },
    { key: "cpc", header: "Efeito CPC 26", value: (a) => (a.reclassifica ? 1 : 0), render: (a) => <CelulaCPC26 a={a} /> },
  ];
  return (
    <Card
      title="Covenants contratuais"
      subtitle={`Última apuração de cada covenant até ${fmtDate(dataBase)} · mesma apuração da carteira de captações (dívida) · folga positiva = dentro do limite`}
      bodyClassName="px-0 pb-0"
    >
      <div className="hidden xl:block">
        <DataTable columns={colunas} rows={covenants} rowKey={(a) => a.cov.id} />
      </div>
      {/* Pop-in (sap.m.Table responsiva): em telas estreitas as colunas descem para baixo do indicador */}
      <ul className="xl:hidden border-t border-[#a8b2bd] divide-y divide-line-soft">
        {covenants.map((a) => {
          const r = rotuloCovenant(a);
          return (
            <li key={a.cov.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text">{a.cov.indicador}</div>
                  <div className="text-xs text-label leading-snug mt-0.5">
                    {a.cov.contratos.join(", ")} · {a.cov.periodicidade.toLowerCase()}
                  </div>
                </div>
                <div className="shrink-0">
                  <ObjectStatus state={r.state}>{r.texto}</ObjectStatus>
                </div>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-2.5 text-[13px]">
                <PopIn rotulo="Valor apurado" valor={fmtValorCovenant(a.cov, a.valor)} />
                <PopIn rotulo="Limite" valor={fmtLimiteCovenant(a.cov)} />
                <PopIn rotulo="Folga" valor={<span className={a.folga >= 0 ? "text-positive" : "text-negative"}>{fmtFolgaCovenant(a.cov, a.folga)}</span>} />
                <PopIn rotulo="Apuração" valor={`${rotuloApuracao(a)} · ${fmtDate(a.dataApuracao)}`} />
              </dl>
              <div className="text-xs text-label leading-snug mt-2">
                <span className="text-text">Waiver:</span>{" "}
                {a.waiver ? `${a.waiver.credor} em ${fmtDate(a.waiver.obtidoEm)}${a.waiverVigente ? " (vigente)" : " (após o balanço)"}` : "—"}
                {" · "}
                <span className="text-text">Efeito CPC 26:</span>{" "}
                <span className={a.reclassifica ? "text-negative font-semibold" : undefined}>{a.reclassifica ? "reclassifica para o circulante" : "não reclassifica"}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PopIn({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-label">{rotulo}</dt>
      <dd className="text-text font-semibold tabular">{valor}</dd>
    </div>
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
