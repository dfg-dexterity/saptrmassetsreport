import clsx from "clsx";
import { CheckCircle2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, CHART_COLORS, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import type { PremissasMercado } from "../../shared/data/mercado";
import { EMPRESAS } from "../../shared/data/empresas";
import { addDays, diffDays, endOfMonth, fmtDate, fmtMonthShort, lastMonthEnds } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../../shared/lib/format";
import { useBenchmarks } from "../context/BenchmarkContext";
import { ESCOPOS, useMestre, type Escopo } from "../context/useDados";
import { relatorioPorId } from "../data/catalogo";
import { FUNDOS, type Fundo } from "../data/fundos";
import { COME_COTAS, type RegimeIR } from "../data/tributacao";
import { compararOperacao, somarComparacoes, SITUACAO_STATE, SITUACAO_TEXTO, type ComparacaoOperacao } from "../lib/benchmark";
import { movimentacaoMestre, rentabilidadeMestre, somaMestre, taxaFundoTexto, type RentabContrato } from "../lib/carteiraMestre";
import { aliquotaIR, fatorCDI } from "../lib/finance";
import { cotaFundo, historicoFundo, posicaoFundo, type EventoComeCotas, type HistoricoFundo, type ResgateFundo } from "../lib/fundos";

const rel = relatorioPorId("r09");
const TIPO = "Fundo de investimento";
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

/** Cor fixa de cada fundo em todos os gráficos (paleta Horizon; tons distintos entre si, cinza-esverdeado no fundo resgatado) */
const CORES_FUNDO = [
  CHART_COLORS[0],
  CHART_COLORS[1],
  CHART_COLORS[2],
  CHART_COLORS[3],
  CHART_COLORS[4],
  CHART_COLORS[5],
  CHART_COLORS[8],
  CHART_COLORS[10],
  CHART_COLORS[9],
];
const corFundo = (f: Fundo) => CORES_FUNDO[FUNDOS.indexOf(f) % CORES_FUNDO.length];

const REGIME_CURTO: Record<string, string> = {
  "Fundo LP (come-cotas 15%)": "Longo prazo · 15%",
  "Fundo CP (come-cotas 20%)": "Curto prazo · 20%",
  "Fundo de ações (15%)": "Ações · sem come-cotas",
};
const regimeCurto = (r: RegimeIR) => REGIME_CURTO[r] ?? r;
const semComeCotas = (f: Fundo) => f.regimeIR === "Fundo de ações (15%)";

/** Benchmark próprio do fundo difere do benchmark cadastrado em % do CDI (multimercado, ações, cambial) */
const benchmarkProprio = (f: Fundo) => f.produto === "Fundo multimercado" || f.produto === "Fundo de ações" || f.produto === "Fundo cambial";

const pctCDI = (v: number) => `${fmtDec(v * 100, 1)}%`;
const pp = (v: number, casas = 2) => `${v >= 0 ? "+" : ""}${fmtDec(v * 100, casas)} p.p.`;
const fmtCota = (v: number) => fmtDec(v, 6);

interface LinhaFundo {
  f: Fundo;
  cor: string;
  status: "Ativo" | "Resgatado";
  hist: HistoricoFundo;
  /** resgate ocorrido até a data-base */
  resgate: ResgateFundo | null;
  cota: number;
  quantidade: number;
  saldo: number;
  rendimentoBruto: number;
  comeCotasPago: number;
  irComplementar: number;
  iof: number;
  irTotal: number;
  rendimentoLiquido: number;
  taxas: number;
  custoComeCotas: number;
  rentabBruta: number;
  rentabLiquida: number;
  aliquotaIR: number;
  diasCorridos: number;
  /** eventos de come-cotas já ocorridos até a data-base */
  eventos: EventoComeCotas[];
  /** próximo come-cotas (projeção com o último dado disponível) */
  proximo: EventoComeCotas | null;
  r12: RentabContrato | null;
  cmp12: ComparacaoOperacao | null;
}

interface EventoLinha extends EventoComeCotas {
  f: Fundo;
  projetado: boolean;
}

function montarLinha(f: Fundo, db: string, p: PremissasMercado): LinhaFundo {
  const hist = historicoFundo(f, p);
  const resgate = hist.resgate && hist.resgate.data <= db ? hist.resgate : null;
  const eventos = hist.comeCotas.filter((e) => e.data <= db);
  const cor = corFundo(f);
  if (resgate) {
    const comeCotasPago = eventos.reduce((s, e) => s + e.ir, 0);
    const dias = diffDays(f.dataAplicacao, resgate.data);
    const irTotal = comeCotasPago + resgate.irComplementar;
    const rendimentoLiquido = resgate.rendimento - resgate.iof - irTotal;
    return {
      f,
      cor,
      status: "Resgatado",
      hist,
      resgate,
      cota: resgate.cota,
      quantidade: 0,
      saldo: 0,
      rendimentoBruto: resgate.rendimento,
      comeCotasPago,
      irComplementar: resgate.irComplementar,
      iof: resgate.iof,
      irTotal,
      rendimentoLiquido,
      taxas: posicaoFundo(f, addDays(resgate.data, -1), p).taxas,
      custoComeCotas: eventos.reduce((s, e) => s + e.ir * (resgate.cota / e.cota - 1), 0),
      rentabBruta: resgate.rendimento / f.valorAplicado,
      rentabLiquida: rendimentoLiquido / f.valorAplicado,
      aliquotaIR: aliquotaIR(dias, f.regimeIR),
      diasCorridos: dias,
      eventos,
      proximo: null,
      r12: null,
      cmp12: null,
    };
  }
  const x = posicaoFundo(f, db, p);
  return {
    f,
    cor,
    status: "Ativo",
    hist,
    resgate: null,
    cota: x.cota,
    quantidade: x.quantidade,
    saldo: x.saldo,
    rendimentoBruto: x.rendimentoBruto,
    comeCotasPago: x.comeCotasPago,
    irComplementar: x.irComplementar,
    iof: x.iof,
    irTotal: x.irTotal,
    rendimentoLiquido: x.rendimentoLiquido,
    taxas: x.taxas,
    custoComeCotas: x.custoComeCotas,
    rentabBruta: x.rentabBruta,
    rentabLiquida: x.rentabLiquida,
    aliquotaIR: x.aliquotaIR,
    diasCorridos: x.diasCorridos,
    eventos,
    proximo: x.proximoComeCotas ? (hist.comeCotas.find((e) => e.data === x.proximoComeCotas) ?? null) : null,
    r12: null,
    cmp12: null,
  };
}

/** Cota do fundo × CDI acumulado desde a aplicação (base 100), por fim de mês */
function serieCotaCDI(f: Fundo, fim: string, p: PremissasMercado) {
  const pts: { rotulo: string; cota: number; cdi: number }[] = [{ rotulo: "Aplic.", cota: 100, cdi: 100 }];
  let acc = 1;
  let prev = f.dataAplicacao;
  let y = Number(f.dataAplicacao.slice(0, 4));
  let m = Number(f.dataAplicacao.slice(5, 7));
  for (;;) {
    const fm = endOfMonth(y, m);
    const d = fm > fim ? fim : fm;
    if (d > prev) {
      acc *= fatorCDI(prev, d, p);
      pts.push({ rotulo: d === fm ? fmtMonthShort(d) : fmtDate(d).slice(0, 5), cota: (cotaFundo(f, d, p) / f.cotaAplicacao) * 100, cdi: acc * 100 });
      prev = d;
    }
    if (fm >= fim) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return pts;
}

export function R09Fundos() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, contratos } = useMestre(escopo);
  const { cadastro } = useBenchmarks();
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const db = p.dataBase;

  const d = useMemo(() => {
    const inicio12 = lastMonthEnds(db, 13)[0];
    const fundos = FUNDOS.filter((f) => (escopo === "todas" || f.empresa === escopo) && f.dataAplicacao <= db);
    const linhas = fundos.map((f) => montarLinha(f, db, p));

    // Rentabilidade × benchmark cadastrado em 12 meses (mesmo método do R03: capital base no início da janela)
    const r12 = rentabilidadeMestre(inicio12, db, p, escopo).filter((r) => r.tipo === TIPO);
    const bmk = r12.map((r) => ({ r, f: FUNDOS.find((f) => f.id === r.codigo)!, c: compararOperacao(r, cadastro, p) }));
    for (const l of linhas) {
      const b = bmk.find((x) => x.f === l.f);
      l.r12 = b?.r ?? null;
      l.cmp12 = b?.c ?? null;
    }
    const bmkTotal = somarComparacoes(bmk.map((x) => x.c));

    // Eventos de come-cotas: histórico até a data-base + próximo projetado de cada fundo em carteira
    const eventos: EventoLinha[] = linhas.flatMap((l) => [
      ...l.eventos.map((e) => ({ ...e, f: l.f, projetado: false })),
      ...(l.proximo ? [{ ...l.proximo, f: l.f, projetado: true }] : []),
    ]);
    eventos.sort((a, b) => a.data.localeCompare(b.data) || a.f.id.localeCompare(b.f.id));

    const ativos = linhas.filter((l) => l.status === "Ativo");
    const proxData =
      ativos
        .map((l) => l.proximo?.data)
        .filter((x): x is string => !!x)
        .sort()[0] ?? null;
    const proxIR = ativos.reduce((s, l) => s + (l.proximo && l.proximo.data === proxData ? l.proximo.ir : 0), 0);
    const cc12 = eventos.filter((e) => !e.projetado && e.data > inicio12 && e.data <= db).reduce((s, e) => s + e.ir, 0);
    const mov = movimentacaoMestre(inicio12, db, p, escopo).porTipo[TIPO];

    // Gráfico: IR antecipado por evento (mai/nov), empilhado por fundo
    const datas = [...new Set(eventos.map((e) => e.data))].sort();
    const fundosGrafico = linhas.filter((l) => eventos.some((e) => e.f === l.f)).map((l) => l.f);
    const grafico = datas.map((dt) => {
      const evs = eventos.filter((e) => e.data === dt);
      const proj = evs.some((e) => e.projetado);
      const row: Record<string, number | string | boolean> = { rotulo: `${fmtMonthShort(dt)}${proj ? "*" : ""}`, data: dt, proj };
      for (const f of fundosGrafico) row[f.id] = evs.filter((e) => e.f === f).reduce((s, e) => s + e.ir, 0) / 1e3;
      return row;
    });

    return { inicio12, linhas, ativos, eventos, bmk, bmkTotal, proxData, proxIR, cc12, mov, grafico, fundosGrafico };
  }, [db, p, escopo, cadastro]);

  const { linhas, ativos } = d;
  const soma = (fn: (l: LinhaFundo) => number, ls: LinhaFundo[] = ativos) => ls.reduce((s, l) => s + fn(l), 0);
  const somaAtivos = (fn: (l: LinhaFundo) => number) => (rows: LinhaFundo[]) =>
    fmtNum(
      soma(
        fn,
        rows.filter((l) => l.status === "Ativo"),
      ),
    );

  const saldo = soma((l) => l.saldo);
  const aplicado = soma((l) => l.f.valorAplicado);
  const rendBruto = soma((l) => l.rendimentoBruto);
  const rendLiq = soma((l) => l.rendimentoLiquido);
  const ccAcumulado = soma((l) => l.comeCotasPago);
  const taxasPagas = soma((l) => l.taxas);
  // Rentabilidade líquida a.a. desde a aplicação, média ponderada pelo saldo
  const rentabAA = saldo > 0 ? soma((l) => l.saldo * (Math.pow(1 + l.rentabLiquida, 365 / Math.max(1, l.diasCorridos)) - 1)) / saldo : 0;

  const saldoMestre = somaMestre(
    contratos.filter((c) => c.tipo === TIPO),
    "saldoCurva",
  );
  const conciliaSaldo = Math.abs(saldoMestre - saldo) < 1;
  const conciliaCC = Math.abs(d.mov.comeCotas - d.cc12) < 1;
  const resgatados = linhas.filter((l) => l.resgate);
  const sel = linhas.find((l) => l.f.id === selecionado) ?? null;

  const custoLinhas = ativos.filter((l) => !semComeCotas(l.f));
  const custoLiq = (l: LinhaFundo) => l.custoComeCotas * (1 - l.aliquotaIR);
  const custoTotal = soma((l) => l.custoComeCotas, custoLinhas);
  const custoLiqTotal = soma(custoLiq, custoLinhas);
  const aplicadoCusto = soma((l) => l.f.valorAplicado, custoLinhas);
  const semAntecipacao = (l: LinhaFundo) => (l.rendimentoLiquido + custoLiq(l)) / l.f.valorAplicado;

  const colunas: Column<LinhaFundo>[] = [
    {
      key: "fundo",
      header: "Fundo",
      sticky: true,
      minWidth: 180,
      value: (l) => l.f.nome,
      render: (l) => (
        <div className="leading-snug max-w-[10.5rem] lg:max-w-none lg:min-w-[15.5rem]">
          <div className="font-semibold text-link">
            {l.f.id} · <span className="text-text">{l.f.nome}</span>
          </div>
          <div className="text-xs text-label">
            {l.f.gestor} · CNPJ {l.f.cnpj}
          </div>
        </div>
      ),
      total: () => (
        <span>
          Em carteira ({ativos.length})
          {resgatados.length > 0 && <span className="hidden lg:inline font-normal text-label text-xs"> · resgatados fora do total</span>}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      value: (l) => l.status,
      render: (l) => (
        <div className="leading-snug">
          <ObjectStatus inverted icon={false} state={l.status === "Ativo" ? "positive" : "neutral"}>
            {l.status}
          </ObjectStatus>
          {l.resgate && <div className="text-xs text-label tabular mt-0.5">{fmtDate(l.resgate.data)}</div>}
        </div>
      ),
    },
    {
      key: "classe",
      header: "Classe / regime de IR",
      minWidth: 180,
      value: (l) => l.f.classe,
      render: (l) => (
        <div className="leading-snug">
          <div className="text-text">{l.f.classe}</div>
          <div className="mt-0.5">
            <Tag color={semComeCotas(l.f) ? "#788fa6" : "#8b47d7"}>{regimeCurto(l.f.regimeIR)}</Tag>
          </div>
        </div>
      ),
    },
    {
      key: "aplicacao",
      header: "Aplicação",
      align: "right",
      value: (l) => l.f.dataAplicacao,
      render: (l) => (
        <div>
          <div>{fmtDate(l.f.dataAplicacao)}</div>
          <div className="text-xs text-label">{fmtNum(l.f.valorAplicado)}</div>
        </div>
      ),
      total: somaAtivos((l) => l.f.valorAplicado),
    },
    {
      key: "cota",
      header: "Cota atual / aplic.",
      align: "right",
      headerTitle: "Cota líquida de taxas de administração e performance na data-base (no resgate, a cota do dia do resgate) e cota da aplicação",
      value: (l) => l.cota,
      render: (l) => (
        <div>
          <div>{fmtCota(l.cota)}</div>
          <div className="text-xs text-label">
            {l.resgate ? "do resgate · " : ""}aplic. {fmtCota(l.f.cotaAplicacao)}
          </div>
        </div>
      ),
    },
    {
      key: "qtd",
      header: "Quantidade de cotas",
      align: "right",
      headerTitle: "Quantidade após os come-cotas (o IR antecipado reduz a quantidade de cotas, sem saída de caixa)",
      value: (l) => l.quantidade,
      render: (l) =>
        l.resgate ? (
          <div>
            <div className="text-label">–</div>
            <div className="text-xs text-label">resgatadas {fmtDec(l.resgate.quantidade, 2)}</div>
          </div>
        ) : (
          <div>
            <div>{fmtDec(l.quantidade, 2)}</div>
            <div className="text-xs text-label">inicial {fmtDec(l.hist.quantidadeInicial, 2)}</div>
          </div>
        ),
    },
    {
      key: "saldo",
      header: "Saldo (R$)",
      align: "right",
      headerTitle: "Valor da cota × quantidade de cotas na data-base",
      value: (l) => l.saldo,
      render: (l) =>
        l.resgate ? (
          <div>
            <div className="text-label">–</div>
            <div className="text-xs text-label">resgate bruto {fmtNum(l.resgate.bruto)}</div>
          </div>
        ) : (
          <span className="font-semibold">{fmtNum(l.saldo)}</span>
        ),
      total: somaAtivos((l) => l.saldo),
    },
    {
      key: "rb",
      header: "Rend. bruto",
      align: "right",
      headerTitle: "Saldo + come-cotas recolhido − valor aplicado (desde a aplicação; já líquido das taxas do fundo)",
      value: (l) => l.rendimentoBruto,
      render: (l) => <span className={l.rendimentoBruto < 0 ? "text-negative" : ""}>{fmtNum(l.rendimentoBruto)}</span>,
      total: somaAtivos((l) => l.rendimentoBruto),
    },
    {
      key: "cc",
      header: "Come-cotas pago",
      align: "right",
      headerTitle: "IR antecipado no come-cotas desde a aplicação",
      value: (l) => l.comeCotasPago,
      render: (l) => (l.comeCotasPago ? fmtNum(l.comeCotasPago) : <span className="text-label">–</span>),
      total: somaAtivos((l) => l.comeCotasPago),
    },
    {
      key: "irc",
      header: "IR complementar",
      align: "right",
      headerTitle:
        "IR total devido se resgatado na data-base (alíquota vigente) − come-cotas já recolhido; provisionado. No fundo resgatado, o IR complementar retido no resgate",
      value: (l) => l.irComplementar,
      render: (l) => (
        <div>
          <div>{l.irComplementar ? fmtNum(l.irComplementar) : <span className="text-label">–</span>}</div>
          <div className="text-xs text-label">{l.resgate ? "retido no resgate" : `provisão · ${fmtPct(l.aliquotaIR, 1)}`}</div>
        </div>
      ),
      total: somaAtivos((l) => l.irComplementar),
    },
    {
      key: "iof",
      header: "IOF",
      align: "right",
      value: (l) => l.iof,
      render: (l) => (l.iof > 0 ? <span className="text-critical font-semibold">{fmtNum(l.iof)}</span> : <span className="text-label">–</span>),
      total: somaAtivos((l) => l.iof),
    },
    {
      key: "rl",
      header: "Rend. líquido",
      align: "right",
      headerTitle: "Rendimento bruto − IOF − IR total (come-cotas + complementar)",
      value: (l) => l.rendimentoLiquido,
      render: (l) => (
        <div>
          <div className={clsx("font-semibold", l.rendimentoLiquido < 0 && "text-negative")}>{fmtNum(l.rendimentoLiquido)}</div>
          {l.resgate && <div className="text-xs text-label">líquido creditado {fmtNum(l.resgate.liquido)}</div>}
        </div>
      ),
      total: somaAtivos((l) => l.rendimentoLiquido),
    },
    {
      key: "rentab",
      header: "Rentab. bruta / líq.",
      align: "right",
      headerTitle: "Desde a aplicação: rendimento bruto e rendimento líquido ÷ valor aplicado",
      value: (l) => l.rentabLiquida,
      render: (l) => (
        <div>
          <div className={l.rentabBruta < 0 ? "text-negative" : ""}>{fmtPct(l.rentabBruta)}</div>
          <div className="text-xs text-label">líq. {fmtPct(l.rentabLiquida)}</div>
        </div>
      ),
      total: (rows) => {
        const at = rows.filter((l) => l.status === "Ativo");
        const ap = soma((l) => l.f.valorAplicado, at);
        return (
          <div>
            <div>{fmtPct(ap > 0 ? soma((l) => l.rendimentoBruto, at) / ap : 0)}</div>
            <div className="text-xs text-label font-normal">líq. {fmtPct(ap > 0 ? soma((l) => l.rendimentoLiquido, at) / ap : 0)}</div>
          </div>
        );
      },
    },
    {
      key: "bmk",
      header: "Benchmark / % CDI 12m",
      align: "right",
      headerTitle: "Benchmark próprio do fundo e % do CDI bruto realizado nos últimos 12 meses (ou desde a aplicação, se posterior)",
      value: (l) => l.r12?.pctCDIBruto ?? null,
      render: (l) => (
        <div>
          <div>{l.f.benchmark}</div>
          <div className="text-xs text-label">{l.r12 ? `${pctCDI(l.r12.pctCDIBruto)} do CDI` : "–"}</div>
        </div>
      ),
    },
    {
      key: "taxas",
      header: "Taxas pagas",
      align: "right",
      headerTitle: "Taxas de administração e performance cobradas na cota desde a aplicação (já deduzidas do saldo)",
      value: (l) => l.taxas,
      render: (l) => fmtNum(l.taxas),
      total: somaAtivos((l) => l.taxas),
    },
    {
      key: "custo",
      header: "Custo do come-cotas",
      align: "right",
      headerTitle: "Custo de oportunidade: rendimento que o IR antecipado no come-cotas teria gerado se permanecesse aplicado no fundo",
      value: (l) => l.custoComeCotas,
      render: (l) =>
        l.custoComeCotas > 0.5 ? <span className="text-critical">{fmtNum(l.custoComeCotas)}</span> : <span className="text-label">–</span>,
      total: somaAtivos((l) => l.custoComeCotas),
    },
    {
      key: "liquidez",
      header: "Liquidez",
      value: (l) => l.f.diasResgate,
      render: (l) => (
        <div className="leading-snug whitespace-nowrap">
          <div className="text-text">{l.f.liquidez}</div>
          <div className="text-xs text-label">crédito em {l.f.diasResgate} d.c.</div>
        </div>
      ),
    },
    {
      key: "taxas-fundo",
      header: "Taxa adm. / perf.",
      align: "right",
      value: (l) => l.f.taxaAdm,
      render: (l) => (
        <div>
          <div>{fmtPct(l.f.taxaAdm)} a.a.</div>
          <div className="text-xs text-label">{l.f.taxaPerf > 0 ? `perf. ${fmtPct(l.f.taxaPerf, 0)} s/ ${l.f.benchmark}` : "sem performance"}</div>
        </div>
      ),
    },
  ];

  const exportar = () =>
    exportarExcel(
      `R09_Fundos_Come-cotas_${db}.xlsx`,
      [
        {
          nome: "R09 - Posições",
          titulo: "R09 – Fundos de investimento e come-cotas: posições",
          subtitulo: `${ESCOPOS.find((e) => e.value === escopo)!.label} · Valores em R$`,
          colunas: [
            { titulo: "Empresa", largura: 10 },
            { titulo: "Fundo", largura: 8 },
            { titulo: "Nome", largura: 32 },
            { titulo: "Gestor", largura: 24 },
            { titulo: "CNPJ", largura: 20 },
            { titulo: "Classe", largura: 26 },
            { titulo: "Regime de IR", largura: 26 },
            { titulo: "Liquidez", largura: 9 },
            { titulo: "Taxa adm. (a.a.)", tipo: "pct" },
            { titulo: "Taxa perf.", tipo: "pct" },
            { titulo: "Status", largura: 11 },
            { titulo: "Data aplicação", tipo: "data", largura: 13 },
            { titulo: "Valor aplicado", tipo: "moeda" },
            { titulo: "Cota da aplicação", tipo: "decimal" },
            { titulo: "Cota atual / do resgate", tipo: "decimal" },
            { titulo: "Quantidade de cotas", tipo: "decimal" },
            { titulo: "Saldo", tipo: "moeda" },
            { titulo: "Rendimento bruto", tipo: "moeda" },
            { titulo: "Come-cotas pago", tipo: "moeda" },
            { titulo: "IR complementar", tipo: "moeda" },
            { titulo: "IOF", tipo: "moeda" },
            { titulo: "Rendimento líquido", tipo: "moeda" },
            { titulo: "Taxas pagas (adm. + perf.)", tipo: "moeda" },
            { titulo: "Custo do come-cotas", tipo: "moeda" },
            { titulo: "Rentab. bruta", tipo: "pct" },
            { titulo: "Rentab. líquida", tipo: "pct" },
            { titulo: "Benchmark do fundo", largura: 14 },
            { titulo: "% CDI bruto 12m", tipo: "pct" },
            { titulo: "Benchmark cadastrado 12m (% CDI)", tipo: "pct" },
            { titulo: "Data resgate", tipo: "data", largura: 13 },
            { titulo: "Resgate bruto", tipo: "moeda" },
            { titulo: "Resgate líquido", tipo: "moeda" },
          ],
          linhas: linhas.map((l) => [
            l.f.empresa,
            l.f.id,
            l.f.nome,
            l.f.gestor,
            l.f.cnpj,
            l.f.classe,
            l.f.regimeIR,
            l.f.liquidez,
            l.f.taxaAdm,
            l.f.taxaPerf,
            l.status,
            l.f.dataAplicacao,
            l.f.valorAplicado,
            l.f.cotaAplicacao,
            l.cota,
            l.resgate ? l.resgate.quantidade : l.quantidade,
            l.saldo,
            l.rendimentoBruto,
            l.comeCotasPago,
            l.irComplementar,
            l.iof,
            l.rendimentoLiquido,
            l.taxas,
            l.custoComeCotas,
            l.rentabBruta,
            l.rentabLiquida,
            l.f.benchmark,
            l.r12?.pctCDIBruto ?? "",
            l.cmp12?.pct ?? "",
            l.resgate?.data ?? "",
            l.resgate?.bruto ?? "",
            l.resgate?.liquido ?? "",
          ]),
          total: [
            "TOTAL EM CARTEIRA",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            aplicado,
            "",
            "",
            "",
            saldo,
            rendBruto,
            ccAcumulado,
            soma((l) => l.irComplementar),
            soma((l) => l.iof),
            rendLiq,
            taxasPagas,
            soma((l) => l.custoComeCotas),
            aplicado > 0 ? rendBruto / aplicado : 0,
            aplicado > 0 ? rendLiq / aplicado : 0,
            "",
            "",
            "",
            "",
            "",
            "",
          ],
          notas: [
            "(i) Saldo = valor da cota × quantidade de cotas; a cota já é líquida das taxas de administração e performance.",
            "(ii) Come-cotas (último dia útil de maio e novembro): 15% nos fundos de longo prazo e 20% nos de curto prazo, por redução da quantidade de cotas; fundos de ações não têm come-cotas.",
            "(iii) IR complementar = IR total pela tabela regressiva (curto prazo 22,5%/20%; ações 15%) − come-cotas já recolhido; provisionado na data-base.",
            "(iv) Custo do come-cotas = rendimento que o IR antecipado teria gerado se permanecesse aplicado (custo de oportunidade).",
            "(v) % CDI 12m: rendimento bruto ÷ (capital base × CDI do período), capital base no início da janela ou na aplicação (mesmo método do R03).",
            '(vi) Fundos resgatados aparecem com status "Resgatado" e não entram no total em carteira. Classificação CPC 48: valor justo por meio do resultado.',
          ],
        },
        {
          nome: "Come-cotas",
          titulo: "R09 – Eventos de come-cotas (histórico até a data-base e próximo evento projetado)",
          subtitulo: `${ESCOPOS.find((e) => e.value === escopo)!.label} · Valores em R$`,
          colunas: [
            { titulo: "Fundo", largura: 8 },
            { titulo: "Nome", largura: 32 },
            { titulo: "Data", tipo: "data", largura: 13 },
            { titulo: "Situação", largura: 12 },
            { titulo: "Cota do evento", tipo: "decimal" },
            { titulo: "Cota de referência", tipo: "decimal" },
            { titulo: "Base tributada", tipo: "moeda" },
            { titulo: "Alíquota", tipo: "pct" },
            { titulo: "IR recolhido", tipo: "moeda" },
            { titulo: "Cotas antes", tipo: "decimal" },
            { titulo: "Cotas depois", tipo: "decimal" },
          ],
          linhas: d.eventos.map((e) => [
            e.f.id,
            e.f.nome,
            e.data,
            e.projetado ? "Projetado" : "Realizado",
            e.cota,
            e.cotaReferencia,
            e.base,
            e.aliquota,
            e.ir,
            e.quantidadeAntes,
            e.quantidadeDepois,
          ]),
          total: [
            "TOTAL REALIZADO",
            "",
            "",
            "",
            "",
            "",
            d.eventos.filter((e) => !e.projetado).reduce((s, e) => s + e.base, 0),
            "",
            d.eventos.filter((e) => !e.projetado).reduce((s, e) => s + e.ir, 0),
            "",
            "",
          ],
          notas: [
            "Eventos projetados calculados com o último dado disponível (CDI e retornos importados do SAP até a data-base).",
            `IR antecipado nos últimos 12 meses: ${fmtBRL(d.cc12)} (conciliado com a movimentação da Carteira-Mestre).`,
          ],
        },
      ],
      db,
    );

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <div className="contents lg:grid lg:grid-cols-3 lg:gap-x-10 lg:gap-y-3">
          <HeaderKpi label="Saldo em cotas" value={fmtCompact(saldo)} sub={`${ativos.length} fundo(s) · cota × quantidade`} />
          <HeaderKpi
            label="Rendimento bruto"
            value={fmtCompact(rendBruto)}
            state={rendBruto >= 0 ? "positive" : "negative"}
            sub="desde a aplicação"
          />
          <HeaderKpi label="Come-cotas recolhido" value={fmtCompact(ccAcumulado)} sub={`acumulado · 12 meses ${fmtCompact(d.cc12)}`} />
          <HeaderKpi
            label="Próximo come-cotas"
            value={d.proxData ? fmtDate(d.proxData) : "—"}
            state={d.proxData ? "critical" : "neutral"}
            sub={d.proxData ? `IR estimado ${fmtCompact(d.proxIR)} · projeção` : "sem fundos sujeitos"}
          />
          <HeaderKpi label="Taxas adm. + perf." value={fmtCompact(taxasPagas)} sub="pagas, embutidas na cota" />
          <HeaderKpi
            label="Rentab. líquida média"
            value={`${fmtDec(rentabAA * 100, 2)}%`}
            unit="a.a."
            state={rentabAA >= 0 ? "neutral" : "negative"}
            sub={`${fmtPct(aplicado > 0 ? rendLiq / aplicado : 0)} desde a aplicação`}
          />
        </div>
      }
      headerExtra={
        <div className="flex flex-col sm:flex-row sm:items-end gap-x-6 gap-y-2 no-print">
          <FilterField label="Empresa" className="w-full sm:w-80 shrink-0">
            <Select
              value={escopo}
              onChange={(v) => {
                setEscopo(v);
                setSelecionado(null);
              }}
              options={ESCOPOS}
            />
          </FilterField>
          <p className="text-[13px] text-label leading-snug sm:text-right sm:ml-auto sm:max-w-xl">
            Cotas, CDI e retornos importados do SAP até {fmtDate(db)}; o próximo come-cotas e o IR estimado são projetados com o último dado
            disponível.
          </p>
        </div>
      }
    >
      <MessageStrip design={conciliaSaldo && conciliaCC ? "positive" : "critical"}>
        <span className="flex flex-wrap gap-x-5 gap-y-1">
          <span className="inline-flex items-start gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-[3px]" />
            <span>
              Saldo em cotas igual à Carteira-Mestre: <strong className="whitespace-nowrap">{fmtBRL(saldoMestre)}</strong>
            </span>
          </span>
          <span className="inline-flex items-start gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-[3px]" />
            <span>
              Come-cotas 12 meses conciliado com a movimentação consolidada: <strong className="whitespace-nowrap">{fmtBRL(d.mov.comeCotas)}</strong>
            </span>
          </span>
        </span>
      </MessageStrip>

      <div className={clsx("grid gap-5", sel ? "lg:grid-cols-[minmax(0,1fr)_420px]" : "grid-cols-1")}>
        <Card
          title={`Fundos de investimento (${linhas.length})`}
          subtitle="Clique em uma linha para ver cadastro, cota × CDI e eventos de come-cotas"
          bodyClassName="px-0 pb-0"
          className="min-w-0 overflow-hidden"
        >
          <DataTable
            columns={colunas}
            rows={linhas}
            rowKey={(l) => l.f.id}
            onRowClick={(l) => setSelecionado(l.f.id === selecionado ? null : l.f.id)}
            selectedKey={selecionado}
            showTotals
            defaultSort={{ key: "saldo", dir: "desc" }}
          />
          <div className="px-4 py-3 text-xs text-label leading-relaxed border-t border-line-soft space-y-1">
            {resgatados.map((l) => (
              <p key={l.f.id}>
                <strong className="text-text">
                  {l.f.id} – {l.f.nome}
                </strong>{" "}
                resgatado em {fmtDate(l.resgate!.data)}: bruto {fmtBRL(l.resgate!.bruto)}, IR complementar {fmtBRL(l.resgate!.irComplementar)} (além
                de {fmtBRL(l.comeCotasPago)} já antecipados no come-cotas), IOF {fmtBRL(l.resgate!.iof)}, líquido creditado{" "}
                {fmtBRL(l.resgate!.liquido)}. Não entra nos totais em carteira.
              </p>
            ))}
            <p>
              Cota líquida das taxas de administração e performance. Rendimento bruto = saldo + come-cotas recolhido − valor aplicado. IR complementar
              provisionado pela alíquota vigente no resgate. Classificação CPC 48: valor justo por meio do resultado (saldo = valor da cota na
              data-base).
            </p>
          </div>
        </Card>
        {sel && <DetalheFundo l={sel} p={p} onClose={() => setSelecionado(null)} />}
      </div>

      <Card
        title="Come-cotas (Lei 14.754/2023)"
        subtitle="IR antecipado semestralmente sobre o rendimento dos fundos, recolhido pelo administrador com a redução da quantidade de cotas"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5">
          <div className="space-y-4">
            <ul className="space-y-2 text-[13px] text-text leading-relaxed list-disc pl-4 marker:text-label">
              <li>
                <strong>Quando:</strong> último dia útil de maio e de novembro.
              </li>
              <li>
                <strong>Alíquota:</strong> {fmtPct(COME_COTAS.aliquotaLP, 0)} nos fundos de longo prazo e {fmtPct(COME_COTAS.aliquotaCP, 0)} nos de
                curto prazo; fundos de ações não têm come-cotas ({fmtPct(COME_COTAS.aliquotaAcoes, 0)} só no resgate).
              </li>
              <li>
                <strong>Base:</strong> (cota do evento − cota de referência) × quantidade de cotas; a cota de referência é a da aplicação ou a do
                último come-cotas, se maior.
              </li>
              <li>
                <strong>Efeito:</strong> redução da quantidade de cotas, sem saída de caixa – o saldo cai pelo valor do IR recolhido.
              </li>
              <li>
                <strong>No resgate:</strong> IR complementar pela tabela regressiva (22,5% até 180 dias → 15% acima de 720 dias; curto prazo
                22,5%/20%) menos o já antecipado.
              </li>
              <li>
                <strong>Contábil (PJ):</strong> o IR retido é antecipação compensável com o IRPJ devido.
              </li>
            </ul>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Mini titulo="IR antecipado · 12 meses" valor={fmtCompact(d.cc12)} sub={`${fmtDate(addDays(d.inicio12, 1))} a ${fmtDate(db)}`} />
              <Mini
                titulo="Acumulado em carteira"
                valor={fmtCompact(ccAcumulado)}
                sub={`${ativos.filter((l) => l.comeCotasPago > 0).length} fundo(s)`}
              />
              <Mini
                titulo="Próximo (projeção)"
                valor={d.proxData ? fmtCompact(d.proxIR) : "—"}
                sub={d.proxData ? fmtDate(d.proxData) : "sem eventos"}
              />
            </div>
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-text">IR antecipado por evento</h4>
            <p className="text-xs text-label mb-2">R$ mil por fundo · * evento projetado com o último dado disponível</p>
            {d.grafico.length ? (
              <div className="h-64 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.grafico} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e5e5e5" />
                    <XAxis dataKey="rotulo" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} interval={0} />
                    <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      cursor={{ fill: "#f2f4f6" }}
                      formatter={(v: number, n: string) => [fmtBRL(v * 1e3), n]}
                      labelFormatter={(_, pl) => {
                        const row = pl?.[0]?.payload as { data?: string; proj?: boolean } | undefined;
                        return row?.data ? `${fmtDate(row.data)}${row.proj ? " (projeção)" : ""}` : "";
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                    {d.fundosGrafico.map((f) => (
                      <Bar key={f.id} dataKey={f.id} name={f.id} stackId="cc" fill={corFundo(f)} isAnimationActive={false}>
                        {d.grafico.map((g) => (
                          <Cell key={String(g.data)} fillOpacity={g.proj ? 0.45 : 1} />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-label py-10 text-center">Nenhum fundo sujeito a come-cotas neste escopo.</p>
            )}
          </div>
        </div>

        <div className="-mx-4 -mb-4 mt-5 border-t border-line-soft">
          <DataTable<EventoLinha>
            columns={[
              {
                key: "fundo",
                header: "Fundo",
                sticky: true,
                minWidth: 170,
                value: (e) => e.f.id,
                render: (e) => (
                  <div className="leading-snug">
                    <div className="font-semibold text-text">
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: corFundo(e.f) }} />
                      {e.f.id}
                    </div>
                    <div className="text-xs text-label truncate max-w-[14rem]">{e.f.nome}</div>
                  </div>
                ),
                total: () => <span>Total realizado</span>,
              },
              { key: "data", header: "Data", align: "right", value: (e) => e.data, render: (e) => fmtDate(e.data) },
              {
                key: "sit",
                header: "Situação",
                value: (e) => (e.projetado ? 1 : 0),
                render: (e) =>
                  e.projetado ? (
                    <ObjectStatus inverted icon={false} state="information">
                      Projetado
                    </ObjectStatus>
                  ) : (
                    <ObjectStatus inverted icon={false} state="positive">
                      Realizado
                    </ObjectStatus>
                  ),
              },
              { key: "cota", header: "Cota do evento", align: "right", value: (e) => e.cota, render: (e) => fmtCota(e.cota) },
              { key: "ref", header: "Cota de referência", align: "right", value: (e) => e.cotaReferencia, render: (e) => fmtCota(e.cotaReferencia) },
              {
                key: "base",
                header: "Base tributada",
                align: "right",
                value: (e) => e.base,
                render: (e) => fmtNum(e.base),
                total: (r) => fmtNum(r.filter((e) => !e.projetado).reduce((s, e) => s + e.base, 0)),
              },
              { key: "aliq", header: "Alíquota", align: "right", value: (e) => e.aliquota, render: (e) => fmtPct(e.aliquota, 0) },
              {
                key: "ir",
                header: "IR recolhido",
                align: "right",
                value: (e) => e.ir,
                render: (e) => <span className={e.projetado ? "text-info" : "font-semibold"}>{fmtNum(e.ir)}</span>,
                total: (r) => fmtNum(r.filter((e) => !e.projetado).reduce((s, e) => s + e.ir, 0)),
              },
              {
                key: "qtd",
                header: "Cotas antes → depois",
                align: "right",
                value: (e) => e.quantidadeAntes - e.quantidadeDepois,
                render: (e) => (
                  <div>
                    <div>
                      {fmtDec(e.quantidadeAntes, 2)} → {fmtDec(e.quantidadeDepois, 2)}
                    </div>
                    <div className="text-xs text-label">−{fmtDec(e.quantidadeAntes - e.quantidadeDepois, 2)} cotas</div>
                  </div>
                ),
              },
            ]}
            rows={d.eventos}
            rowKey={(e) => `${e.f.id}|${e.data}`}
            showTotals
            defaultSort={{ key: "data", dir: "asc" }}
            emptyText="Nenhum evento de come-cotas neste escopo"
          />
        </div>
      </Card>

      <Card
        title="Custo do come-cotas na rentabilidade"
        subtitle="Fundos em carteira sujeitos a come-cotas · desde a aplicação"
        bodyClassName="px-0 pb-0"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0">
            <DataTable<LinhaFundo>
              columns={[
                {
                  key: "fundo",
                  header: "Fundo",
                  sticky: true,
                  minWidth: 150,
                  value: (l) => l.f.id,
                  render: (l) => (
                    <div className="leading-snug">
                      <div className="font-semibold text-text">{l.f.id}</div>
                      <div className="text-xs text-label truncate max-w-[12rem]">{l.f.nome}</div>
                    </div>
                  ),
                  total: () => <span>Total ({custoLinhas.length})</span>,
                },
                {
                  key: "cc",
                  header: "Come-cotas pago",
                  align: "right",
                  value: (l) => l.comeCotasPago,
                  render: (l) => (l.comeCotasPago > 0.5 ? fmtNum(l.comeCotasPago) : <span className="text-label">–</span>),
                  total: (r) => fmtNum(soma((l) => l.comeCotasPago, r)),
                },
                {
                  key: "custo",
                  header: "Custo de oportunidade",
                  align: "right",
                  headerTitle:
                    "Rendimento que o IR antecipado teria gerado até a data-base (bruto) e o mesmo valor líquido do IR que incidiria no resgate",
                  value: (l) => l.custoComeCotas,
                  render: (l) => (
                    <div>
                      <div>{l.custoComeCotas > 0.5 ? fmtNum(l.custoComeCotas) : <span className="text-label">–</span>}</div>
                      {l.custoComeCotas > 0.5 && <div className="text-xs text-label">líq. IR {fmtNum(custoLiq(l))}</div>}
                    </div>
                  ),
                  total: (r) => (
                    <div>
                      <div>{fmtNum(soma((l) => l.custoComeCotas, r))}</div>
                      <div className="text-xs text-label font-normal">líq. IR {fmtNum(soma(custoLiq, r))}</div>
                    </div>
                  ),
                },
                {
                  key: "efetiva",
                  header: "Rentab. líq. efetiva",
                  align: "right",
                  value: (l) => l.rentabLiquida,
                  render: (l) => fmtPct(l.rentabLiquida),
                  total: (r) =>
                    fmtPct(
                      soma((l) => l.rendimentoLiquido, r) /
                        Math.max(
                          1,
                          soma((l) => l.f.valorAplicado, r),
                        ),
                    ),
                },
                {
                  key: "sem",
                  header: "Sem antecipação",
                  align: "right",
                  value: (l) => semAntecipacao(l),
                  render: (l) => fmtPct(semAntecipacao(l)),
                  total: (r) =>
                    fmtPct(
                      soma((l) => l.rendimentoLiquido + custoLiq(l), r) /
                        Math.max(
                          1,
                          soma((l) => l.f.valorAplicado, r),
                        ),
                    ),
                },
                {
                  key: "dif",
                  header: "Custo (p.p.)",
                  align: "right",
                  value: (l) => semAntecipacao(l) - l.rentabLiquida,
                  render: (l) =>
                    l.custoComeCotas > 0.5 ? (
                      <span className="text-critical font-semibold">{pp(-(semAntecipacao(l) - l.rentabLiquida))}</span>
                    ) : (
                      <span className="text-label">–</span>
                    ),
                  total: (r) => (
                    <span className="text-critical">
                      {pp(
                        -soma(custoLiq, r) /
                          Math.max(
                            1,
                            soma((l) => l.f.valorAplicado, r),
                          ),
                      )}
                    </span>
                  ),
                },
              ]}
              rows={custoLinhas}
              rowKey={(l) => l.f.id}
              showTotals
              defaultSort={{ key: "custo", dir: "desc" }}
              emptyText="Nenhum fundo em carteira sujeito a come-cotas neste escopo"
            />
          </div>
          <div className="px-4 py-4 border-t lg:border-t-0 lg:border-l border-line-soft space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              <Mini
                titulo="Custo de oportunidade"
                valor={custoLinhas.length ? fmtBRL(custoTotal) : "—"}
                sub={custoLinhas.length ? `líquido do IR ${fmtBRL(custoLiqTotal)}` : "sem fundos sujeitos"}
              />
              <Mini
                titulo="Efeito na rentab. líquida"
                valor={aplicadoCusto > 0 ? pp(-custoLiqTotal / aplicadoCusto) : "—"}
                sub={aplicadoCusto > 0 ? `sobre ${fmtCompact(aplicadoCusto)} aplicados` : "sem fundos sujeitos"}
              />
            </div>
            <p className="text-xs text-label leading-relaxed">
              O come-cotas não é imposto adicional – é antecipação do IR que seria devido no resgate. O custo está no tempo: o valor recolhido deixa
              de render dentro do fundo (custo de oportunidade). Rentabilidade sem antecipação = (rendimento líquido + custo de oportunidade líquido
              do IR que incidiria no resgate, à alíquota vigente) ÷ valor aplicado. Fundos de ações não têm come-cotas.
            </p>
          </div>
        </div>
      </Card>

      <Card
        title="Rentabilidade × benchmark (12 meses)"
        subtitle={`${fmtDate(addDays(d.inicio12, 1))} a ${fmtDate(db)} · benchmark cadastrado em % do CDI · inclui fundos resgatados no período`}
        bodyClassName="px-0 pb-0"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="min-w-0">
            <DataTable<(typeof d.bmk)[number]>
              columns={[
                {
                  key: "fundo",
                  header: "Fundo",
                  sticky: true,
                  minWidth: 150,
                  value: (x) => x.f.id,
                  render: (x) => (
                    <div className="leading-snug">
                      <div className="font-semibold text-text">
                        {x.f.id}
                        {benchmarkProprio(x.f) && <sup className="ml-0.5 text-label font-normal">1</sup>}
                      </div>
                      <div className="text-xs text-label whitespace-nowrap">
                        {x.r.status === "Liquidada"
                          ? `resgatado em ${fmtDate(x.r.fim)}`
                          : x.r.inicio > d.inicio12
                            ? `desde ${fmtDate(x.r.inicio)}`
                            : "12 meses"}
                      </div>
                    </div>
                  ),
                  total: () => <span>Fundos ({d.bmk.length})</span>,
                },
                {
                  key: "real",
                  header: "% CDI realizado",
                  align: "right",
                  value: (x) => x.c.realizado,
                  render: (x) => <span className="font-semibold">{pctCDI(x.c.realizado)}</span>,
                  total: () => pctCDI(d.bmkTotal.realizado),
                },
                {
                  key: "bmk",
                  header: "Benchmark cadastrado",
                  align: "right",
                  headerTitle:
                    "% do CDI do benchmark cadastrado no período (regra mais específica: produto > portfolio > empresa > carteira), capitalizado dia a dia",
                  value: (x) => x.c.pct,
                  render: (x) => (
                    <div>
                      <div>{pctCDI(x.c.pct)}</div>
                      <div className="text-xs text-label truncate max-w-[11rem] ml-auto">
                        {x.c.trechos
                          .map((t) => t.regra?.descricao ?? "Sem regra")
                          .filter((v, i, a) => a.indexOf(v) === i)
                          .join(" → ")}
                      </div>
                    </div>
                  ),
                  total: () => pctCDI(d.bmkTotal.pct),
                },
                {
                  key: "dif",
                  header: "Diferença",
                  align: "right",
                  value: (x) => x.c.realizado - x.c.pct,
                  render: (x) => (
                    <span className={clsx(x.c.situacao === "abaixo" ? "text-critical" : x.c.situacao === "acima" ? "text-positive" : "text-label")}>
                      {pp(x.c.realizado - x.c.pct, 1)}
                    </span>
                  ),
                  total: () => pp(d.bmkTotal.realizado - d.bmkTotal.pct, 1),
                },
                {
                  key: "sit",
                  header: "Situação",
                  value: (x) => x.c.realizado - x.c.pct,
                  render: (x) => <ObjectStatus state={SITUACAO_STATE[x.c.situacao]}>{SITUACAO_TEXTO[x.c.situacao]}</ObjectStatus>,
                  total: () =>
                    d.bmk.length ? (
                      <ObjectStatus state={SITUACAO_STATE[d.bmkTotal.situacao]}>{SITUACAO_TEXTO[d.bmkTotal.situacao]}</ObjectStatus>
                    ) : (
                      ""
                    ),
                },
                {
                  key: "proprio",
                  header: "Benchmark do fundo",
                  value: (x) => x.f.benchmark,
                  render: (x) => <span className="whitespace-nowrap">{x.f.benchmark}</span>,
                },
              ]}
              rows={d.bmk}
              rowKey={(x) => x.f.id}
              showTotals
              defaultSort={{ key: "real", dir: "desc" }}
              emptyText="Nenhum fundo no período"
            />
          </div>
          <div className="px-4 py-4 border-t lg:border-t-0 lg:border-l border-line-soft space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              <Mini
                titulo="% do CDI realizado · fundos"
                valor={d.bmk.length ? pctCDI(d.bmkTotal.realizado) : "—"}
                sub={`benchmark ${d.bmk.length ? pctCDI(d.bmkTotal.pct) : "—"} do CDI`}
              />
              <Mini
                titulo="Excesso s/ benchmark"
                valor={d.bmk.length ? fmtCompact(d.bmkTotal.excesso) : "—"}
                sub={d.bmk.length ? SITUACAO_TEXTO[d.bmkTotal.situacao].toLowerCase() : "sem fundos"}
              />
            </div>
            <p className="text-xs text-label leading-relaxed">
              % do CDI realizado = rendimento bruto ÷ (capital base × CDI do período), com capital base no início da janela ou na aplicação – mesmo
              método do R03. Benchmark: regra mais específica do cadastro (produto &gt; portfolio &gt; empresa &gt; carteira), capitalizada dia a dia.
              Em linha: ±0,5 p.p.
            </p>
            <p className="text-xs text-label leading-relaxed">
              <sup>1</sup> Multimercado (retorno absoluto, performance sobre o CDI), ações (Ibovespa) e cambial (PTAX): o benchmark próprio do fundo
              difere do benchmark cadastrado em % do CDI, que serve apenas como referência do custo de oportunidade do caixa.
            </p>
          </div>
        </div>
      </Card>
    </ReportPage>
  );
}

function Mini({ titulo, valor, sub }: { titulo: string; valor: string; sub: string }) {
  return (
    <div className="rounded-lg bg-[#f5f6f7] px-3 py-2 min-w-0">
      <div className="text-xs text-label truncate">{titulo}</div>
      <div className="text-lg font-bold text-text tabular whitespace-nowrap">{valor}</div>
      <div className="text-xs text-label tabular truncate">{sub}</div>
    </div>
  );
}

function DetalheFundo({ l, p, onClose }: { l: LinhaFundo; p: PremissasMercado; onClose: () => void }) {
  const { f } = l;
  const fim = l.resgate ? l.resgate.data : p.dataBase;
  const serie = useMemo(() => serieCotaCDI(f, fim, p), [f, fim, p]);
  const ultimo = serie[serie.length - 1];
  const valores = serie.flatMap((x) => [x.cota, x.cdi]);
  const passo = Math.max(...valores) - Math.min(...valores) > 24 ? 10 : 5;
  const yMin = Math.floor(Math.min(...valores) / passo) * passo;
  const yMax = Math.ceil(Math.max(...valores) / passo) * passo;
  const yTicks = Array.from({ length: Math.round((yMax - yMin) / passo) + 1 }, (_, i) => yMin + i * passo);
  const eventos = [...l.eventos.map((e) => ({ ...e, projetado: false })), ...(l.proximo ? [{ ...l.proximo, projetado: true }] : [])];
  return (
    <aside className="bg-white rounded-[var(--radius-card)] shadow-fiori-lg lg:shadow-fiori overflow-hidden self-auto lg:self-start flex flex-col fixed inset-x-4 bottom-4 top-[calc(4rem+env(safe-area-inset-top,0px))] z-30 lg:sticky lg:inset-auto lg:top-[4.25rem] lg:z-auto lg:max-h-[calc(100vh-5.5rem)]">
      <header className="px-4 pt-3.5 pb-3 border-b border-line-soft">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-label">
              {f.id} · Transação {f.transacao}
            </div>
            <h3 className="text-lg font-bold text-text leading-snug">{f.nome}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-link hover:bg-hover" aria-label="Fechar detalhe">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <ObjectStatus inverted icon={false} state={l.status === "Ativo" ? "positive" : "neutral"}>
            {l.status === "Ativo" ? "Ativo" : `Resgatado em ${fmtDate(l.resgate!.data)}`}
          </ObjectStatus>
          <ObjectStatus inverted icon={false} state="critical">
            {f.cpc48}
          </ObjectStatus>
          <Tag color={semComeCotas(f) ? "#788fa6" : "#8b47d7"}>{regimeCurto(f.regimeIR)}</Tag>
          <Tag>Rating {f.rating}</Tag>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto fiori-scroll px-4 py-4 space-y-5">
        <section>
          <h4 className="text-sm font-bold text-text mb-2">Cadastro</h4>
          <dl className="space-y-1.5 text-[13px]">
            <Linha label="Gestor" valor={f.gestor} quebra />
            <Linha label="Administrador" valor={f.administrador} quebra />
            <Linha label="CNPJ" valor={f.cnpj} />
            <Linha label="Classe" valor={f.classe} quebra />
            <Linha label="Produto" valor={f.produto} />
            <Linha label="Rentabilidade-alvo" valor={taxaFundoTexto(f)} quebra />
            <Linha label="Benchmark do fundo" valor={f.benchmark} />
            <Linha
              label="Taxa adm. / perf."
              valor={`${fmtPct(f.taxaAdm)} a.a. / ${f.taxaPerf > 0 ? `${fmtPct(f.taxaPerf, 0)} s/ ${f.benchmark}` : "—"}`}
            />
            <Linha label="Liquidez" valor={`${f.liquidez} (crédito em ${f.diasResgate} d.c.)`} />
            <Linha label="Empresa" valor={`${f.empresa} – ${EMPRESAS[f.empresa]?.nome ?? ""}`} quebra />
            <Linha label="Portfolio" valor={f.portfolio} />
            <Linha label="Classificação CPC 48" valor="Valor justo por meio do resultado" quebra />
          </dl>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">{l.resgate ? `Resgate em ${fmtDate(l.resgate.data)}` : "Valores na data-base"}</h4>
          <dl className="space-y-1.5 text-[13px]">
            <Linha
              label={`Aplicação em ${fmtDate(f.dataAplicacao)} (${fmtDec(l.hist.quantidadeInicial, 2)} × ${fmtCota(f.cotaAplicacao)})`}
              valor={fmtBRL(f.valorAplicado, true)}
            />
            {l.resgate ? (
              <Linha
                label={`Resgate bruto (${fmtDec(l.resgate.quantidade, 2)} × ${fmtCota(l.resgate.cota)})`}
                valor={fmtBRL(l.resgate.bruto, true)}
                forte
              />
            ) : (
              <Linha label={`Saldo (${fmtDec(l.quantidade, 2)} × ${fmtCota(l.cota)})`} valor={fmtBRL(l.saldo, true)} forte />
            )}
            <Linha
              label="Rendimento bruto"
              valor={fmtBRL(l.rendimentoBruto, true)}
              cor={l.rendimentoBruto >= 0 ? "text-positive" : "text-negative"}
            />
            <Linha label="(−) Come-cotas recolhido" valor={`− ${fmtBRL(l.comeCotasPago, true)}`} />
            <Linha
              label={`(−) IR complementar ${l.resgate ? "retido no resgate" : "provisionado"} (${fmtPct(l.aliquotaIR, 1)} − come-cotas)`}
              valor={`− ${fmtBRL(l.irComplementar, true)}`}
            />
            <Linha label="(−) IOF" valor={`− ${fmtBRL(l.iof, true)}`} />
            <div className="border-t border-line-soft pt-1.5">
              <Linha label="Rendimento líquido" valor={fmtBRL(l.rendimentoLiquido, true)} forte />
            </div>
            {l.resgate && <Linha label="Líquido creditado (aplicação + rend. líquido)" valor={fmtBRL(l.resgate.liquido, true)} forte />}
            <Linha label="Rentab. bruta / líquida" valor={`${fmtPct(l.rentabBruta)} / ${fmtPct(l.rentabLiquida)}`} />
            <Linha label="Taxas adm. + perf. pagas (na cota)" valor={fmtBRL(l.taxas, true)} />
            <Linha label="Custo do come-cotas" valor={fmtBRL(l.custoComeCotas, true)} cor={l.custoComeCotas > 0.5 ? "text-critical" : undefined} />
          </dl>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text">Cota × CDI acumulado</h4>
          <p className="text-xs text-label mb-1">
            Base 100 na aplicação · cota {pctVar(ultimo.cota)} × CDI {pctVar(ultimo.cdi)} até {fmtDate(fim)}
          </p>
          <div className="h-48 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis dataKey="rotulo" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#a8b2bd" }} minTickGap={8} />
                <YAxis
                  tick={AXIS_STYLE}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  domain={[yMin, yMax]}
                  ticks={yTicks}
                  tickFormatter={(v: number) => fmtDec(v, 0)}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtDec(v, 2), n]} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <ReferenceLine y={100} stroke="#a8b2bd" />
                <Line dataKey="cota" name="Cota do fundo" stroke={l.cor} strokeWidth={2.25} dot={false} isAnimationActive={false} />
                <Line
                  dataKey="cdi"
                  name="CDI acumulado"
                  stroke="#1d2d3e"
                  strokeWidth={1.75}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Eventos de come-cotas</h4>
          {semComeCotas(f) ? (
            <p className="text-[13px] text-label">Fundo de ações: sem come-cotas; IR de {fmtPct(COME_COTAS.aliquotaAcoes, 0)} apenas no resgate.</p>
          ) : eventos.length === 0 ? (
            <p className="text-[13px] text-label">Nenhum evento até a data-base.</p>
          ) : (
            <ul className="divide-y divide-line-soft rounded-lg border border-line-soft">
              {eventos.map((e) => (
                <li key={e.data} className="px-3 py-2 text-[13px]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-text tabular">
                      {fmtDate(e.data)} · {fmtPct(e.aliquota, 0)}
                    </span>
                    <span className="flex items-center gap-2">
                      {e.projetado && (
                        <ObjectStatus inverted icon={false} state="information">
                          Projetado
                        </ObjectStatus>
                      )}
                      <span className="tabular font-semibold text-text whitespace-nowrap">IR {fmtBRL(e.ir)}</span>
                    </span>
                  </div>
                  <div className="text-xs text-label tabular mt-0.5">
                    Cota {fmtCota(e.cota)} (ref. {fmtCota(e.cotaReferencia)}) · base {fmtBRL(e.base)}
                  </div>
                  <div className="text-xs text-label tabular">
                    Cotas {fmtDec(e.quantidadeAntes, 2)} → {fmtDec(e.quantidadeDepois, 2)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {l.proximo && <p className="text-xs text-label mt-2">Evento projetado com o último dado disponível (CDI e retornos importados do SAP).</p>}
        </section>
      </div>
    </aside>
  );
}

function pctVar(base100: number): string {
  const v = base100 / 100 - 1;
  return `${v >= 0 ? "+" : ""}${fmtPct(v)}`;
}

function Linha({ label, valor, forte, cor, quebra }: { label: string; valor: string; forte?: boolean; cor?: string; quebra?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-label shrink-0 max-w-[60%]">{label}</dt>
      <dd
        className={clsx(
          "text-right min-w-0",
          quebra ? "break-words" : "tabular whitespace-nowrap",
          forte ? "font-bold text-text text-sm" : "text-text",
          cor,
        )}
      >
        {valor}
      </dd>
    </div>
  );
}
