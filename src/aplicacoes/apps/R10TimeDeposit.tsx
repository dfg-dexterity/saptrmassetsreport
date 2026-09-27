import clsx from "clsx";
import { X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, Field } from "../../shared/components/fiori/Card";
import { DataTable, type Column } from "../../shared/components/fiori/DataTable";
import { FilterField, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, CHART_COLORS, CHART_SEMANTIC, HeaderKpi } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, Tag, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { EMPRESAS } from "../../shared/data/empresas";
import { ptaxDoMes, type PremissasMercado } from "../../shared/data/mercado";
import {
  addDays,
  diffDays,
  endOfMonth,
  fmtDate,
  fmtMonthShort,
  fromDay,
  lastMonthEnds,
  monthOf,
  previousMonthEnd,
  toDay,
  yearOf,
} from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct } from "../../shared/lib/format";
import { ptaxNaData } from "../../shared/lib/taxas";
import { relatorioPorId } from "../data/catalogo";
import { PARAMETROS_TIME_DEPOSIT as PARAM, TIME_DEPOSITS, type TimeDeposit } from "../data/timeDeposits";
import { ALIQUOTA_IRPJ_CSLL } from "../data/tributacao";
import { ESCOPOS, useMestre, type Escopo } from "../context/useDados";
import { somaMestre, taxaTDTexto } from "../lib/carteiraMestre";
import { posicaoTimeDeposit, resgateTimeDeposit, type PosicaoTimeDeposit } from "../lib/timeDeposit";

const rel = relatorioPorId("r10");
const tooltipStyle = { borderRadius: 8, border: "1px solid #d9d9d9", fontFamily: "72, Arial", fontSize: 12 };

// ---------------------------------------------------------------------------
// Moedas e formatação
// ---------------------------------------------------------------------------

type MoedaTD = TimeDeposit["moeda"];
const MOEDAS_TD: MoedaTD[] = ["USD", "EUR"];
const COR_MOEDA: Record<MoedaTD, string> = { USD: CHART_COLORS[0], EUR: CHART_COLORS[1] };
const SIMBOLO: Record<MoedaTD, string> = { USD: "US$", EUR: "€" };
const REFERENCIA: Record<MoedaTD, { nome: string; taxa: number }> = {
  USD: { nome: "SOFR", taxa: PARAM.sofr },
  EUR: { nome: "€STR", taxa: PARAM.estr },
};

const FMT_ME: Record<MoedaTD, Intl.NumberFormat> = {
  USD: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  EUR: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};

/** Valor na moeda original (US$ 1.234,56 / € 1.234,56) */
function fmtME(v: number, m: MoedaTD): string {
  if (!Number.isFinite(v)) return "—";
  return FMT_ME[m].format(Math.round(v * 100) / 100 || 0).replace("-", "−");
}

/** US$ 15,8 mil / € 403,5 mil */
function fmtMECompacto(v: number, m: MoedaTD): string {
  const abs = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (abs >= 1e6) return `${s}${SIMBOLO[m]} ${(abs / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (abs >= 1e3) return `${s}${SIMBOLO[m]} ${(abs / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `${s}${SIMBOLO[m]} ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

const fmtPtax = (v: number) => fmtDec(v, 4);

/** Valor com sinal explícito (+1.234 / −1.234) */
function comSinal(v: number, fmt: (x: number) => string = (x) => fmtNum(x)): string {
  const s = fmt(v);
  return v > 0 && /[1-9]/.test(s) ? `+${s}` : s;
}

/** Cor semântica pelo sinal (tolerância na unidade do valor: R$ 0,50 por padrão; use 0,00005 para frações) */
function corValor(v: number, tol = 0.5): string {
  return v > tol ? "text-positive" : v < -tol ? "text-negative" : "text-text";
}

function estadoValor(v: number): ValueState {
  return v > 0.5 ? "positive" : v < -0.5 ? "negative" : "neutral";
}

function fimDoMes(iso: string): string {
  return endOfMonth(yearOf(iso), monthOf(iso));
}

// ---------------------------------------------------------------------------
// Posições, resultado e série mensal
// ---------------------------------------------------------------------------

interface Resultado {
  principalBRL: number;
  juros: number;
  vc: number;
  saldoBRL: number;
  iof: number;
  tarifa: number;
  ir: number;
  bruto: number;
  liquido: number;
}

interface PontoMensal {
  data: string;
  evento: "Remessa" | "Fim de mês" | "Resgate";
  ptax: number;
  saldoME: number;
  saldoBRL: number;
  jurosMes: number | null;
  vcMes: number | null;
}

interface LinhaTD {
  td: TimeDeposit;
  pos: PosicaoTimeDeposit;
  liquidado: boolean;
  resgate: ReturnType<typeof resgateTimeDeposit>;
  r: Resultado;
  /** o fim do mês anterior é anterior à remessa – a base da variação do mês é a PTAX da remessa */
  remessaNoMes: boolean;
  serie: PontoMensal[];
}

/** Decomposição do resultado em R$: posição na data-base (ativo) ou realizado no resgate (liquidado) */
function resultadoTD(
  td: TimeDeposit,
  pos: PosicaoTimeDeposit,
  liquidado: boolean,
  res: LinhaTD["resgate"],
  p: PremissasMercado,
): Resultado {
  const principalBRL = td.principal * td.ptaxAplicacao;
  if (!liquidado) {
    return {
      principalBRL,
      juros: pos.jurosBRL,
      vc: pos.variacaoCambial,
      saldoBRL: pos.saldoBRL,
      iof: pos.iofCambio,
      tarifa: pos.tarifa,
      ir: pos.irpjCsll,
      bruto: pos.rendimentoBruto,
      liquido: pos.rendimentoLiquido,
    };
  }
  const juros = (res.valorME - td.principal) * res.ptax;
  const vc = td.principal * (res.ptax - td.ptaxAplicacao);
  const bruto = res.bruto - principalBRL;
  const iof = principalBRL * PARAM.iofCambio;
  const tarifa = PARAM.tarifaUSD * ptaxNaData("USD", td.dataAplicacao, p);
  const ir = Math.max(0, bruto - iof - tarifa) * ALIQUOTA_IRPJ_CSLL;
  return { principalBRL, juros, vc, saldoBRL: res.bruto, iof, tarifa, ir, bruto, liquido: bruto - iof - tarifa - ir };
}

/** Remessa, fins de mês até a data-base (ou até o vencimento) e resgate */
function serieMensal(td: TimeDeposit, p: PremissasMercado, liquidado: boolean, res: LinhaTD["resgate"]): PontoMensal[] {
  const out: PontoMensal[] = [
    {
      data: td.dataAplicacao,
      evento: "Remessa",
      ptax: td.ptaxAplicacao,
      saldoME: td.principal,
      saldoBRL: td.principal * td.ptaxAplicacao,
      jurosMes: null,
      vcMes: null,
    },
  ];
  let antME = td.principal;
  let antPtax = td.ptaxAplicacao;
  for (let m = fimDoMes(td.dataAplicacao); m <= p.dataBase && m < td.vencimento; m = fimDoMes(addDays(m, 1))) {
    if (m <= td.dataAplicacao) continue;
    const x = posicaoTimeDeposit(td, m, p);
    out.push({
      data: m,
      evento: "Fim de mês",
      ptax: x.ptax,
      saldoME: x.saldoME,
      saldoBRL: x.saldoBRL,
      jurosMes: (x.saldoME - antME) * x.ptax,
      vcMes: x.variacaoCambialMes,
    });
    antME = x.saldoME;
    antPtax = x.ptax;
  }
  if (liquidado) {
    out.push({
      data: res.data,
      evento: "Resgate",
      ptax: res.ptax,
      saldoME: res.valorME,
      saldoBRL: res.bruto,
      jurosMes: (res.valorME - antME) * res.ptax,
      vcMes: antME * (res.ptax - antPtax),
    });
  }
  return out;
}

const vazio = (n: number): string[] => Array<string>(n).fill("");

function somaR(ls: LinhaTD[], fn: (l: LinhaTD) => number): number {
  return ls.reduce((s, l) => s + fn(l), 0);
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function R10TimeDeposit() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, contratos } = useMestre(escopo);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const db = p.dataBase;

  const linhas = useMemo<LinhaTD[]>(
    () =>
      TIME_DEPOSITS.filter((td) => (escopo === "todas" || td.empresa === escopo) && td.dataAplicacao <= db).map((td) => {
        const pos = posicaoTimeDeposit(td, db, p);
        const liquidado = td.vencimento <= db;
        const resgate = resgateTimeDeposit(td, p);
        return {
          td,
          pos,
          liquidado,
          resgate,
          r: resultadoTD(td, pos, liquidado, resgate, p),
          remessaNoMes: previousMonthEnd(db) < td.dataAplicacao,
          serie: serieMensal(td, p, liquidado, resgate),
        };
      }),
    [escopo, db, p],
  );

  const ativos = useMemo(() => linhas.filter((l) => !l.liquidado), [linhas]);

  const t = useMemo(() => {
    const s = (fn: (l: LinhaTD) => number) => somaR(ativos, fn);
    const porMoeda = MOEDAS_TD.map((moeda) => {
      const ls = ativos.filter((l) => l.td.moeda === moeda);
      const sm = (fn: (l: LinhaTD) => number) => somaR(ls, fn);
      return {
        moeda,
        qtd: ls.length,
        principalME: sm((l) => l.td.principal),
        saldoME: sm((l) => l.pos.saldoME),
        jurosME: sm((l) => l.pos.jurosME),
        principalBRL: sm((l) => l.r.principalBRL),
        saldoBRL: sm((l) => l.pos.saldoBRL),
        juros: sm((l) => l.r.juros),
        vc: sm((l) => l.r.vc),
        vcMes: sm((l) => l.pos.variacaoCambialMes),
        custos: sm((l) => l.r.iof + l.r.tarifa),
        ir: sm((l) => l.r.ir),
        liquido: sm((l) => l.r.liquido),
      };
    }).filter((g) => g.qtd > 0);
    return {
      principalBRL: s((l) => l.r.principalBRL),
      saldoBRL: s((l) => l.pos.saldoBRL),
      juros: s((l) => l.r.juros),
      vc: s((l) => l.r.vc),
      vcMes: s((l) => l.pos.variacaoCambialMes),
      iof: s((l) => l.r.iof),
      tarifa: s((l) => l.r.tarifa),
      ir: s((l) => l.r.ir),
      bruto: s((l) => l.r.bruto),
      liquido: s((l) => l.r.liquido),
      porMoeda,
    };
  }, [ativos]);

  // Conferência com a Carteira-Mestre (mesmo motor usado por R02, R05, R07, R11 e R12)
  const mestre = useMemo(() => {
    const cs = contratos.filter((c) => c.tipo === "Time deposit");
    return { saldo: somaMestre(cs, "saldoCurva"), liquido: somaMestre(cs, "rendimentoLiquido"), qtd: cs.length };
  }, [contratos]);
  const conciliado = Math.abs(mestre.saldo - t.saldoBRL) < 1 && Math.abs(mestre.liquido - t.liquido) < 1 && mestre.qtd === ativos.length;

  // PTAX (BCB) – 12 meses
  const ptax = useMemo(() => {
    const fins = lastMonthEnds(db, 13);
    const serie = fins.map((d) => ({ t: toDay(d), data: d, USD: ptaxDoMes("USD", d.slice(0, 7)), EUR: ptaxDoMes("EUR", d.slice(0, 7)) }));
    const antMes = previousMonthEnd(db);
    const linhasPtax = MOEDAS_TD.map((m) => {
      const atual = m === "USD" ? p.ptaxUSD : p.ptaxEUR;
      const ant = ptaxDoMes(m, antMes.slice(0, 7));
      const ano = ptaxDoMes(m, fins[0].slice(0, 7));
      return { moeda: m, atual, ant, ano, varMes: atual / ant - 1, varAno: atual / ano - 1 };
    });
    const remessas = linhas.filter((l) => l.td.dataAplicacao >= fins[0]);
    const valores = [...serie.flatMap((x) => [x.USD, x.EUR]), ...remessas.map((l) => l.td.ptaxAplicacao)];
    const yMin = Math.floor((Math.min(...valores) - 0.05) * 10) / 10;
    const yMax = Math.ceil((Math.max(...valores) + 0.05) * 10) / 10;
    return { fins, antMes, serie, linhasPtax, remessas, yMin, yMax };
  }, [db, p, linhas]);

  const varMesPtax = new Map(ptax.linhasPtax.map((x) => [x.moeda, x.varMes]));
  const moedasAtivas = t.porMoeda.map((g) => g.moeda);

  const sel = linhas.find((l) => l.td.id === selecionado) ?? null;
  const proximo = [...ativos].sort((a, b) => a.pos.prazoRemanescente - b.pos.prazoRemanescente)[0] ?? null;

  const totalPorMoeda = (fn: (l: LinhaTD) => number) => (rows: LinhaTD[]) => {
    const ms = MOEDAS_TD.filter((m) => rows.some((l) => l.td.moeda === m && !l.liquidado));
    if (!ms.length) return "";
    return (
      <div className="space-y-0.5">
        {ms.map((m) => (
          <div key={m}>
            {fmtME(
              somaR(
                rows.filter((l) => l.td.moeda === m && !l.liquidado),
                fn,
              ),
              m,
            )}
          </div>
        ))}
      </div>
    );
  };
  const totalBRL =
    (fn: (l: LinhaTD) => number, cor = false) =>
    (rows: LinhaTD[]) => {
      const v = somaR(
        rows.filter((l) => !l.liquidado),
        fn,
      );
      return <span className={clsx(cor && corValor(v))}>{cor ? comSinal(v) : fmtNum(v)}</span>;
    };
  const brl =
    (fn: (l: LinhaTD) => number, cor = false, forte = false) =>
    (l: LinhaTD) =>
      l.liquidado ? (
        <span className="text-label">–</span>
      ) : (
        <span className={clsx(cor && corValor(fn(l)), forte && "font-semibold")}>{cor ? comSinal(fn(l)) : fmtNum(fn(l))}</span>
      );

  const colunas: Column<LinhaTD>[] = [
    {
      key: "td",
      header: "Time deposit",
      sticky: true,
      value: (l) => l.td.id,
      render: (l) => (
        <div>
          <div className="font-semibold text-link tabular">{l.td.id}</div>
          <div className="text-xs text-label whitespace-nowrap">
            {l.td.transacao} · Emp. {l.td.empresa}
          </div>
        </div>
      ),
      total: (rows) => <span>Total ({rows.filter((l) => !l.liquidado).length})</span>,
    },
    {
      key: "banco",
      header: "Banco / praça",
      minWidth: 190,
      value: (l) => l.td.banco,
      render: (l) => (
        <div>
          <div className="font-semibold text-text whitespace-nowrap">{l.td.banco}</div>
          <div className="text-xs text-label whitespace-nowrap">{l.td.praca}</div>
        </div>
      ),
    },
    {
      key: "grupo",
      header: "Grupo / rating",
      value: (l) => l.td.grupo,
      render: (l) => (
        <div>
          <div className="text-text whitespace-nowrap">{l.td.grupo}</div>
          <div className="text-xs text-label">Rating {l.td.rating}</div>
        </div>
      ),
    },
    {
      key: "moeda",
      header: "Moeda",
      align: "center",
      value: (l) => l.td.moeda,
      render: (l) => <Tag color={COR_MOEDA[l.td.moeda]}>{l.td.moeda}</Tag>,
    },
    {
      key: "principal",
      header: "Principal (ME)",
      align: "right",
      value: (l) => l.r.principalBRL,
      render: (l) => (
        <div>
          <div>{fmtME(l.td.principal, l.td.moeda)}</div>
          <div className="text-xs text-label">R$ {fmtNum(l.r.principalBRL)} na remessa</div>
        </div>
      ),
      total: totalPorMoeda((l) => l.td.principal),
    },
    {
      key: "taxa",
      header: "Taxa / referência",
      headerTitle:
        "Taxa contratada na moeda original (juros simples ACT/360, pagos no vencimento) e spread sobre a taxa de referência cadastrada nas Premissas",
      value: (l) => l.td.taxa,
      render: (l) => {
        const ref = REFERENCIA[l.td.moeda];
        return (
          <div className="whitespace-nowrap">
            <div>{taxaTDTexto(l.td)}</div>
            <div className="text-xs text-label">
              {ref.nome} {fmtPct(ref.taxa)} + {fmtDec((l.td.taxa - ref.taxa) * 100, 2)} p.p.
            </div>
          </div>
        );
      },
    },
    { key: "aplicacao", header: "Aplicação", align: "right", value: (l) => l.td.dataAplicacao, render: (l) => fmtDate(l.td.dataAplicacao) },
    {
      key: "vencimento",
      header: "Vencimento",
      align: "right",
      value: (l) => l.td.vencimento,
      render: (l) => (
        <div>
          <div>{fmtDate(l.td.vencimento)}</div>
          {l.liquidado ? (
            <div className="text-xs text-label">liquidado</div>
          ) : (
            <div className={clsx("text-xs", l.pos.prazoRemanescente <= 30 ? "text-critical font-semibold" : "text-label")}>
              {l.pos.prazoRemanescente} dias
            </div>
          )}
        </div>
      ),
    },
    {
      key: "ptaxRem",
      header: "PTAX remessa",
      align: "right",
      value: (l) => l.td.ptaxAplicacao,
      render: (l) => fmtPtax(l.td.ptaxAplicacao),
    },
    {
      key: "ptaxAnt",
      header: "PTAX mês anterior",
      align: "right",
      headerTitle:
        "PTAX do fim do mês anterior à data-base; para remessas feitas no próprio mês, a base da variação do mês é a PTAX da remessa",
      value: (l) => l.pos.ptaxMesAnterior,
      render: (l) =>
        l.liquidado ? (
          <span className="text-label">–</span>
        ) : (
          <div>
            <div>{fmtPtax(l.pos.ptaxMesAnterior)}</div>
            {l.remessaNoMes && <div className="text-xs text-label">remessa no mês</div>}
          </div>
        ),
    },
    {
      key: "ptaxDb",
      header: "PTAX data-base",
      align: "right",
      value: (l) => (l.liquidado ? l.resgate.ptax : l.pos.ptax),
      render: (l) => {
        const v = l.liquidado ? l.resgate.ptax : l.pos.ptax;
        const d = v / l.td.ptaxAplicacao - 1;
        return (
          <div>
            <div className="font-semibold">{fmtPtax(v)}</div>
            <div className={clsx("text-xs", corValor(d, 0.00005))}>
              {comSinal(d, (x) => fmtPct(x))} {l.liquidado ? "no resgate" : "s/ remessa"}
            </div>
          </div>
        );
      },
    },
    {
      key: "saldoME",
      header: "Saldo (ME)",
      align: "right",
      value: (l) => l.pos.saldoME * l.pos.ptax,
      render: (l) =>
        l.liquidado ? (
          <div>
            <div className="text-label">{fmtME(l.resgate.valorME, l.td.moeda)}</div>
            <div className="text-xs text-label">resgatado em {fmtDate(l.resgate.data)}</div>
          </div>
        ) : (
          fmtME(l.pos.saldoME, l.td.moeda)
        ),
      total: totalPorMoeda((l) => l.pos.saldoME),
    },
    {
      key: "jurosME",
      header: "Juros (ME)",
      align: "right",
      value: (l) => l.pos.jurosBRL,
      render: (l) => (l.liquidado ? <span className="text-label">–</span> : fmtME(l.pos.jurosME, l.td.moeda)),
      total: totalPorMoeda((l) => l.pos.jurosME),
    },
    {
      key: "saldoBRL",
      header: "Saldo (R$)",
      align: "right",
      value: (l) => (l.liquidado ? 0 : l.pos.saldoBRL),
      render: (l) =>
        l.liquidado ? (
          <div>
            <div className="text-label">{fmtNum(l.resgate.bruto)}</div>
            <div className="text-xs text-label">resgate bruto</div>
          </div>
        ) : (
          <span className="font-semibold">{fmtNum(l.pos.saldoBRL)}</span>
        ),
      total: totalBRL((l) => l.pos.saldoBRL),
    },
    {
      key: "jurosBRL",
      header: "Juros (R$)",
      align: "right",
      value: (l) => l.r.juros,
      render: brl((l) => l.r.juros),
      total: totalBRL((l) => l.r.juros),
    },
    {
      key: "vc",
      header: "Var. cambial acumulada",
      align: "right",
      headerTitle: "Principal × (PTAX da data-base − PTAX da remessa); os juros são convertidos pela PTAX da data-base",
      value: (l) => l.r.vc,
      render: brl((l) => l.r.vc, true),
      total: totalBRL((l) => l.r.vc, true),
    },
    {
      key: "vcMes",
      header: "Var. cambial do mês",
      align: "right",
      headerTitle: "Saldo em moeda do fim do mês anterior × (PTAX da data-base − PTAX do mês anterior)",
      value: (l) => l.pos.variacaoCambialMes,
      render: brl((l) => l.pos.variacaoCambialMes, true),
      total: totalBRL((l) => l.pos.variacaoCambialMes, true),
    },
    {
      key: "iof",
      header: "IOF câmbio",
      align: "right",
      value: (l) => l.r.iof,
      render: brl((l) => l.r.iof),
      total: totalBRL((l) => l.r.iof),
    },
    {
      key: "tarifa",
      header: "Tarifa",
      align: "right",
      value: (l) => l.r.tarifa,
      render: brl((l) => l.r.tarifa),
      total: totalBRL((l) => l.r.tarifa),
    },
    {
      key: "ir",
      header: "IRPJ/CSLL (34%)",
      align: "right",
      value: (l) => l.r.ir,
      render: brl((l) => l.r.ir),
      total: totalBRL((l) => l.r.ir),
    },
    {
      key: "liquido",
      header: "Resultado líquido",
      align: "right",
      value: (l) => l.r.liquido,
      render: (l) =>
        l.liquidado ? (
          <div>
            <div className={clsx("font-semibold", corValor(l.r.liquido))}>{comSinal(l.r.liquido)}</div>
            <div className="text-xs text-label">realizado</div>
          </div>
        ) : (
          <span className={clsx("font-semibold", corValor(l.r.liquido))}>{comSinal(l.r.liquido)}</span>
        ),
      total: totalBRL((l) => l.r.liquido, true),
    },
    {
      key: "status",
      header: "Status",
      value: (l) => (l.liquidado ? 2 : l.pos.prazoRemanescente <= 30 ? 0 : 1),
      render: (l) =>
        l.liquidado ? (
          <ObjectStatus state="neutral">Liquidado</ObjectStatus>
        ) : l.pos.prazoRemanescente <= 30 ? (
          <ObjectStatus state="critical">Vence em {l.pos.prazoRemanescente} dias</ObjectStatus>
        ) : (
          <ObjectStatus state="information">Ativo</ObjectStatus>
        ),
    },
  ];

  const escopoLabel = ESCOPOS.find((e) => e.value === escopo)!.label;

  const exportar = () =>
    exportarExcel(
      `R10_Time_Deposits_${db}.xlsx`,
      [
        {
          nome: "R10 - Posições",
          titulo: "R10 – Time deposits (depósitos a prazo no exterior)",
          subtitulo: `${escopoLabel} · Valores em R$ convertidos pela PTAX de venda (BCB)`,
          colunas: [
            { titulo: "Empresa", largura: 10 },
            { titulo: "TD", largura: 8 },
            { titulo: "Transação", largura: 12 },
            { titulo: "Banco", largura: 24 },
            { titulo: "Praça", largura: 24 },
            { titulo: "Grupo econômico", largura: 18 },
            { titulo: "Rating", largura: 8 },
            { titulo: "Moeda", largura: 8 },
            { titulo: "Principal (ME)", tipo: "decimal", largura: 16 },
            { titulo: "Taxa contratada", largura: 18 },
            { titulo: "Referência", largura: 16 },
            { titulo: "Aplicação", tipo: "data", largura: 12 },
            { titulo: "Vencimento", tipo: "data", largura: 12 },
            { titulo: "Prazo remanescente (dias)", tipo: "inteiro", largura: 14 },
            { titulo: "Status", largura: 12 },
            { titulo: "PTAX remessa", largura: 12 },
            { titulo: "PTAX mês anterior", largura: 12 },
            { titulo: "PTAX data-base", largura: 12 },
            { titulo: "Principal na remessa (R$)", tipo: "moeda" },
            { titulo: "Saldo (ME)", tipo: "decimal", largura: 16 },
            { titulo: "Juros (ME)", tipo: "decimal", largura: 14 },
            { titulo: "Saldo (R$)", tipo: "moeda" },
            { titulo: "Juros (R$)", tipo: "moeda" },
            { titulo: "Variação cambial acumulada (R$)", tipo: "moeda" },
            { titulo: "Variação cambial do mês (R$)", tipo: "moeda" },
            { titulo: "IOF câmbio (R$)", tipo: "moeda" },
            { titulo: "Tarifa (R$)", tipo: "moeda" },
            { titulo: "IRPJ/CSLL 34% (R$)", tipo: "moeda" },
            { titulo: "Resultado líquido (R$)", tipo: "moeda" },
            { titulo: "Resgate no vencimento (ME)", tipo: "decimal", largura: 16 },
            { titulo: "PTAX do resgate", largura: 12 },
            { titulo: "Resgate bruto (R$)", tipo: "moeda" },
          ],
          linhas: linhas.map((l) => {
            const ref = REFERENCIA[l.td.moeda];
            return [
              l.td.empresa,
              l.td.id,
              l.td.transacao,
              l.td.banco,
              l.td.praca,
              l.td.grupo,
              l.td.rating,
              l.td.moeda,
              l.td.principal,
              taxaTDTexto(l.td),
              `${ref.nome} + ${fmtDec((l.td.taxa - ref.taxa) * 100, 2)} p.p.`,
              l.td.dataAplicacao,
              l.td.vencimento,
              l.liquidado ? 0 : l.pos.prazoRemanescente,
              l.liquidado ? "Liquidado" : "Ativo",
              l.td.ptaxAplicacao,
              l.liquidado ? "" : l.pos.ptaxMesAnterior,
              l.liquidado ? l.resgate.ptax : l.pos.ptax,
              l.r.principalBRL,
              l.liquidado ? 0 : l.pos.saldoME,
              l.liquidado ? 0 : l.pos.jurosME,
              l.liquidado ? 0 : l.pos.saldoBRL,
              l.r.juros,
              l.r.vc,
              l.liquidado ? 0 : l.pos.variacaoCambialMes,
              l.r.iof,
              l.r.tarifa,
              l.r.ir,
              l.r.liquido,
              l.resgate.valorME,
              l.resgate.ptax,
              l.resgate.bruto,
            ];
          }),
          total: [
            "TOTAL (posições ativas)",
            ...vazio(17),
            t.principalBRL,
            ...vazio(2),
            t.saldoBRL,
            t.juros,
            t.vc,
            t.vcMes,
            t.iof,
            t.tarifa,
            t.ir,
            t.liquido,
            ...vazio(3),
          ],
          notas: [
            "(i) Juros simples na moeda original, base ACT/360, pagos no vencimento. Saldo (R$) = saldo em moeda × PTAX de venda (BCB) da data-base, importada do SAP (TCURR, tipo M).",
            "(ii) Variação cambial acumulada = principal × (PTAX da data-base − PTAX da remessa); juros (R$) = juros em moeda × PTAX da data-base. Juros + variação cambial = saldo (R$) − principal na remessa.",
            "(iii) Variação cambial do mês = saldo em moeda do fim do mês anterior × (PTAX da data-base − PTAX do mês anterior); remessas feitas no mês usam a PTAX da remessa como base.",
            `(iv) IOF câmbio de ${fmtPct(PARAM.iofCambio)} sobre o valor da remessa; tarifa de US$ ${PARAM.tarifaUSD} por operação. IRPJ/CSLL de ${fmtPct(ALIQUOTA_IRPJ_CSLL, 0)} provisionado sobre o resultado positivo (sem IRRF – rendimento no exterior compõe o lucro real).`,
            "(v) Resgate no vencimento projetado com a PTAX da data-base (último dado disponível). Totais em R$ consideram somente as posições ativas; colunas em moeda original não são somadas entre moedas.",
          ],
        },
        {
          nome: "R10 - Série mensal",
          titulo: "R10 – Time deposits: evolução mensal desde a aplicação",
          subtitulo: `${escopoLabel} · Fim de mês: PTAX, saldo em moeda e em R$, juros do mês e variação cambial do mês`,
          colunas: [
            { titulo: "TD", largura: 8 },
            { titulo: "Moeda", largura: 8 },
            { titulo: "Data", tipo: "data", largura: 12 },
            { titulo: "Evento", largura: 12 },
            { titulo: "PTAX", largura: 10 },
            { titulo: "Saldo (ME)", tipo: "decimal", largura: 16 },
            { titulo: "Saldo (R$)", tipo: "moeda" },
            { titulo: "Juros do mês (R$)", tipo: "moeda" },
            { titulo: "Variação cambial do mês (R$)", tipo: "moeda" },
          ],
          linhas: linhas.flatMap((l) =>
            l.serie.map((s) => [l.td.id, l.td.moeda, s.data, s.evento, s.ptax, s.saldoME, s.saldoBRL, s.jurosMes ?? "", s.vcMes ?? ""]),
          ),
          notas: [
            "Juros do mês convertidos pela PTAX do fim do mês; variação cambial do mês sobre o saldo em moeda (principal + juros) do fim do mês anterior.",
            "Para cada TD, Σ juros do mês + Σ variação cambial do mês = saldo (R$) na data-base − principal na remessa (resultado bruto).",
          ],
        },
        {
          nome: "R10 - PTAX",
          titulo: "PTAX de venda (BCB) – fim de mês, importada do SAP (TCURR, tipo M)",
          colunas: [
            { titulo: "Fim de mês", tipo: "data", largura: 12 },
            { titulo: "USD", largura: 10 },
            { titulo: "EUR", largura: 10 },
          ],
          linhas: ptax.serie.map((x) => [x.data, x.USD, x.EUR]),
        },
      ],
      db,
    );

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      headerExtra={
        <div className="flex flex-col md:flex-row md:items-end gap-3 md:gap-6">
          <FilterField label="Empresa" className="md:w-80 no-print">
            <Select
              value={escopo}
              onChange={(v) => {
                setEscopo(v);
                setSelecionado(null);
              }}
              options={ESCOPOS}
            />
          </FilterField>
          <p className="text-[13px] text-label leading-snug md:pb-2">
            PTAX de venda (BCB) importada do SAP – TCURR, tipo M – em {fmtDate(db)}:{" "}
            <strong className="text-text font-semibold tabular whitespace-nowrap">USD {fmtPtax(p.ptaxUSD)}</strong> ·{" "}
            <strong className="text-text font-semibold tabular whitespace-nowrap">EUR {fmtPtax(p.ptaxEUR)}</strong>. Após a data-base, os
            valores são projetados com a PTAX da data-base (último dado disponível).
          </p>
        </div>
      }
      kpis={
        <>
          <HeaderKpi label="Saldo em R$" value={fmtCompact(t.saldoBRL)} sub={`${ativos.length} TD(s) · saldo ME × PTAX`} />
          <HeaderKpi
            label="Juros (moeda original)"
            value={fmtCompact(t.juros)}
            state={t.juros > 0 ? "positive" : "neutral"}
            sub={t.porMoeda.length ? t.porMoeda.map((g) => fmtMECompacto(g.jurosME, g.moeda)).join(" · ") : "—"}
          />
          <HeaderKpi
            label="Variação cambial acumulada"
            value={fmtCompact(t.vc)}
            state={estadoValor(t.vc)}
            sub="principal × Δ PTAX desde a remessa"
          />
          <HeaderKpi
            label="Variação cambial do mês"
            value={fmtCompact(t.vcMes)}
            state={estadoValor(t.vcMes)}
            sub={
              moedasAtivas.length
                ? `PTAX no mês: ${moedasAtivas.map((m) => `${m} ${comSinal(varMesPtax.get(m) ?? 0, (x) => fmtPct(x))}`).join(" · ")}`
                : "—"
            }
          />
          <HeaderKpi label="IOF câmbio + tarifas" value={fmtCompact(t.iof + t.tarifa)} sub={`IOF ${fmtPct(PARAM.iofCambio)} na remessa`} />
          <HeaderKpi
            label="IRPJ/CSLL provisionado"
            value={fmtCompact(t.ir)}
            sub={`${fmtPct(ALIQUOTA_IRPJ_CSLL, 0)} s/ resultado positivo`}
          />
          <HeaderKpi
            label="Resultado líquido"
            value={fmtCompact(t.liquido)}
            state={estadoValor(t.liquido)}
            sub={t.principalBRL > 0 ? `${comSinal(t.liquido / t.principalBRL, (x) => fmtPct(x))} s/ principal em R$` : "—"}
          />
        </>
      }
    >
      {ativos.length > 0 && (
        <MessageStrip design={conciliado ? "positive" : "critical"}>
          {conciliado ? "Conciliado com a Carteira-Mestre" : "Divergência com a Carteira-Mestre"} – tipo Time deposit, {mestre.qtd}{" "}
          contrato(s): saldo de <strong className="whitespace-nowrap">{fmtBRL(mestre.saldo)}</strong> e resultado líquido de{" "}
          <strong className="whitespace-nowrap">{fmtBRL(mestre.liquido)}</strong>, a mesma base de R02, R05, R07, R11 e R12.
        </MessageStrip>
      )}

      <div className={clsx("grid gap-5", sel ? "lg:grid-cols-[minmax(0,1fr)_420px]" : "grid-cols-1")}>
        <Card
          title={`Time deposits (${linhas.length})`}
          subtitle="Clique em uma linha para ver a decomposição do resultado e a evolução mensal"
          bodyClassName="px-0 pb-0"
          className="min-w-0 overflow-hidden"
        >
          {linhas.length ? (
            <DataTable
              columns={colunas}
              rows={linhas}
              rowKey={(l) => l.td.id}
              onRowClick={(l) => setSelecionado(l.td.id === selecionado ? null : l.td.id)}
              selectedKey={selecionado}
              showTotals
              defaultSort={{ key: "saldoBRL", dir: "desc" }}
            />
          ) : (
            <p className="py-12 px-4 text-center text-sm text-label border-t border-line-soft">
              Nenhum time deposit da empresa selecionada até a data-base de {fmtDate(db)}.
            </p>
          )}
          <p className="px-4 py-3 text-xs text-label leading-relaxed border-t border-line-soft">
            Juros simples na moeda original (ACT/360), pagos no vencimento. Saldo (R$) = saldo em moeda × PTAX da data-base; variação
            cambial acumulada = principal × (PTAX da data-base − PTAX da remessa), com os juros convertidos pela PTAX da data-base – juros +
            variação cambial = saldo (R$) − principal na remessa. Totais em moeda original por moeda; totais em R$ somente das posições
            ativas.
          </p>
        </Card>
        {sel && <DetalheTD l={sel} p={p} onClose={() => setSelecionado(null)} />}
      </div>

      {proximo && (
        <MessageStrip>
          Próximo vencimento: <strong>{proximo.td.id}</strong> ({proximo.td.banco}) em {fmtDate(proximo.td.vencimento)}, em{" "}
          {proximo.pos.prazoRemanescente} dias – resgate de <strong>{fmtME(proximo.resgate.valorME, proximo.td.moeda)}</strong> projetado em{" "}
          <strong>{fmtBRL(proximo.resgate.bruto)}</strong> com a PTAX da data-base ({fmtPtax(proximo.resgate.ptax)}), último dado disponível
          importado do SAP. A PTAX efetiva do fechamento de câmbio definirá o valor em R$ e a variação cambial realizada.
        </MessageStrip>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card
          title="PTAX (BCB) – 12 meses"
          subtitle="PTAX de venda de fim de mês (R$ por unidade) · pontos: PTAX do fechamento de câmbio de cada remessa"
        >
          <div className="h-64 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ptax.serie} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e5e5" />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={[ptax.serie[0].t, ptax.serie[ptax.serie.length - 1].t]}
                  ticks={ptax.serie.map((x) => x.t)}
                  tickFormatter={(v: number) => fmtMonthShort(fromDay(v))}
                  interval="preserveStartEnd"
                  minTickGap={8}
                  tick={AXIS_STYLE}
                  tickLine={false}
                  axisLine={{ stroke: "#a8b2bd" }}
                />
                <YAxis
                  domain={[ptax.yMin, ptax.yMax]}
                  tickFormatter={(v: number) => fmtDec(v, 2)}
                  tick={AXIS_STYLE}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(v: number) => `PTAX de ${fmtDate(fromDay(v))}`}
                  formatter={(v: number, n: string) => [fmtPtax(v), n]}
                />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
                <Line
                  dataKey="USD"
                  name="USD"
                  stroke={COR_MOEDA.USD}
                  strokeWidth={2.25}
                  dot={{ r: 2.5, fill: COR_MOEDA.USD }}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="EUR"
                  name="EUR"
                  stroke={COR_MOEDA.EUR}
                  strokeWidth={2.25}
                  dot={{ r: 2.5, fill: COR_MOEDA.EUR }}
                  isAnimationActive={false}
                />
                {ptax.remessas.map((l) => (
                  <ReferenceDot
                    key={l.td.id}
                    x={toDay(l.td.dataAplicacao)}
                    y={l.td.ptaxAplicacao}
                    r={5}
                    fill="#ffffff"
                    stroke={COR_MOEDA[l.td.moeda]}
                    strokeWidth={2.5}
                    label={{
                      value: l.td.id,
                      position: l.td.ptaxAplicacao < ptaxNaData(l.td.moeda, l.td.dataAplicacao, p) ? "bottom" : "top",
                      fontSize: 11,
                      fill: "#1d2d3e",
                      fontWeight: 600,
                    }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto fiori-scroll mt-3">
            <table className="w-full text-xs sm:text-[13px] border-separate border-spacing-0">
              <thead>
                <tr className="text-label">
                  <th className="text-left font-semibold py-1.5 pr-2 border-b border-[#a8b2bd] align-bottom">Moeda</th>
                  <th className="text-right font-semibold py-1.5 px-1.5 border-b border-[#a8b2bd] whitespace-nowrap align-bottom">
                    Mês anterior
                    <div className="text-xs font-normal">{fmtDate(ptax.antMes)}</div>
                  </th>
                  <th className="text-right font-semibold py-1.5 px-1.5 border-b border-[#a8b2bd] whitespace-nowrap align-bottom">
                    Data-base
                    <div className="text-xs font-normal">{fmtDate(db)}</div>
                  </th>
                  <th className="text-right font-semibold py-1.5 px-1.5 border-b border-[#a8b2bd] whitespace-nowrap align-bottom">
                    Variação
                    <div className="text-xs font-normal">no mês</div>
                  </th>
                  <th className="text-right font-semibold py-1.5 pl-1.5 border-b border-[#a8b2bd] whitespace-nowrap align-bottom">
                    Variação
                    <div className="text-xs font-normal">12 meses</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ptax.linhasPtax.map((x) => (
                  <tr key={x.moeda}>
                    <td className="py-1.5 pr-2 border-b border-line-soft">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-text">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COR_MOEDA[x.moeda] }} />
                        {x.moeda}
                      </span>
                    </td>
                    <td className="py-1.5 px-1.5 text-right tabular border-b border-line-soft">{fmtPtax(x.ant)}</td>
                    <td className="py-1.5 px-1.5 text-right tabular font-semibold border-b border-line-soft">{fmtPtax(x.atual)}</td>
                    <td
                      className={clsx(
                        "py-1.5 px-1.5 text-right tabular font-semibold border-b border-line-soft",
                        corValor(x.varMes, 0.00005),
                      )}
                    >
                      {comSinal(x.varMes, (v) => fmtPct(v))}
                    </td>
                    <td className={clsx("py-1.5 pl-1.5 text-right tabular border-b border-line-soft", corValor(x.varAno, 0.00005))}>
                      {comSinal(x.varAno, (v) => fmtPct(v))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-label mt-2 leading-relaxed">
            Para um ativo em moeda estrangeira, alta da PTAX gera variação cambial ativa (receita) e queda gera variação cambial passiva
            (despesa). Variação de 12 meses sobre a PTAX de {fmtDate(ptax.fins[0])}.
          </p>
        </Card>

        <ResultadoPorMoeda grupos={t.porMoeda} total={t} />
      </div>

      <TratamentoContabil />
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Resultado por moeda
// ---------------------------------------------------------------------------

interface GrupoMoeda {
  moeda: MoedaTD;
  qtd: number;
  saldoME: number;
  principalBRL: number;
  saldoBRL: number;
  juros: number;
  vc: number;
  vcMes: number;
  custos: number;
  ir: number;
  liquido: number;
}

function ResultadoPorMoeda({
  grupos,
  total,
}: {
  grupos: GrupoMoeda[];
  total: {
    principalBRL: number;
    saldoBRL: number;
    juros: number;
    vc: number;
    vcMes: number;
    iof: number;
    tarifa: number;
    ir: number;
    liquido: number;
  };
}) {
  if (!grupos.length) {
    return (
      <Card title="Resultado por moeda" subtitle="USD × EUR – valores em R$">
        <p className="text-sm text-label py-6 text-center">Nenhum time deposit ativo na data-base para a empresa selecionada.</p>
      </Card>
    );
  }
  const mil = (v: number) => Math.round(v / 100) / 10;
  const dados = [
    { k: "Juros", ...Object.fromEntries(grupos.map((g) => [g.moeda, mil(g.juros)])) },
    { k: "Variação cambial", ...Object.fromEntries(grupos.map((g) => [g.moeda, mil(g.vc)])) },
    { k: "IOF + tarifa", ...Object.fromEntries(grupos.map((g) => [g.moeda, -mil(g.custos)])) },
    { k: "IRPJ/CSLL", ...Object.fromEntries(grupos.map((g) => [g.moeda, -mil(g.ir)])) },
    { k: "Resultado líquido", ...Object.fromEntries(grupos.map((g) => [g.moeda, mil(g.liquido)])) },
  ];
  const linhasTabela: { rotulo: string; v: (g: GrupoMoeda) => number; total: number; sinal?: -1; cor?: boolean; forte?: boolean }[] = [
    { rotulo: "Saldo em R$", v: (g) => g.saldoBRL, total: total.saldoBRL, forte: true },
    { rotulo: "(+) Juros", v: (g) => g.juros, total: total.juros },
    { rotulo: "(±) Variação cambial acumulada", v: (g) => g.vc, total: total.vc, cor: true },
    { rotulo: "(−) IOF câmbio + tarifa", v: (g) => g.custos, total: total.iof + total.tarifa, sinal: -1 },
    { rotulo: "(−) IRPJ/CSLL provisionado", v: (g) => g.ir, total: total.ir, sinal: -1 },
    { rotulo: "(=) Resultado líquido", v: (g) => g.liquido, total: total.liquido, cor: true, forte: true },
    { rotulo: "Variação cambial do mês", v: (g) => g.vcMes, total: total.vcMes, cor: true },
  ];
  const cel = (v: number, l: (typeof linhasTabela)[number]) => {
    const x = v * (l.sinal ?? 1);
    return <span className={clsx(l.cor && corValor(x))}>{l.cor ? comSinal(x) : fmtNum(x)}</span>;
  };
  return (
    <Card title="Resultado por moeda" subtitle="USD × EUR – resultado acumulado desde a remessa, em R$ mil (gráfico) e R$ (tabela)">
      <div className="-ml-2" style={{ height: dados.length * 40 + 48 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} layout="vertical" barCategoryGap="24%" barGap={2} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid horizontal={false} stroke="#e5e5e5" />
            <XAxis
              type="number"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: "#a8b2bd" }}
              tickFormatter={(v: number) => fmtNum(v)}
            />
            <YAxis
              type="category"
              dataKey="k"
              tick={{ ...AXIS_STYLE, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={104}
              interval={0}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number, n: string) => [`R$ ${fmtDec(v, 1)} mil`, n]}
              cursor={{ fill: "#0070f2", fillOpacity: 0.05 }}
            />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "72, Arial" }} iconType="circle" iconSize={8} />
            <ReferenceLine x={0} stroke="#a8b2bd" />
            {grupos.map((g) => (
              <Bar
                key={g.moeda}
                dataKey={g.moeda}
                name={g.moeda}
                fill={COR_MOEDA[g.moeda]}
                radius={[0, 3, 3, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto fiori-scroll mt-3">
        <table className="w-full text-xs sm:text-[13px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="text-left font-semibold py-1.5 pr-2 border-b border-[#a8b2bd]">R$</th>
              {grupos.map((g) => (
                <th key={g.moeda} className="text-right font-semibold py-1.5 px-1.5 border-b border-[#a8b2bd] whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COR_MOEDA[g.moeda] }} />
                    {g.moeda} ({g.qtd})
                  </span>
                  <div className="text-xs text-label font-normal">{fmtMECompacto(g.saldoME, g.moeda)}</div>
                </th>
              ))}
              {grupos.length > 1 && <th className="text-right font-bold py-1.5 pl-1.5 border-b border-[#a8b2bd] bg-[#f5f6f7]">Total</th>}
            </tr>
          </thead>
          <tbody>
            {linhasTabela.map((l) => (
              <tr key={l.rotulo} className={l.forte ? "font-bold" : ""}>
                <td className={clsx("py-1.5 pr-2 border-b border-line-soft min-w-[6.5rem]", l.forte ? "text-text" : "text-label")}>
                  {l.rotulo}
                </td>
                {grupos.map((g) => (
                  <td key={g.moeda} className="py-1.5 px-1.5 text-right tabular border-b border-line-soft whitespace-nowrap">
                    {cel(l.v(g), l)}
                  </td>
                ))}
                {grupos.length > 1 && (
                  <td className="py-1.5 pl-1.5 text-right tabular border-b border-line-soft bg-[#f5f6f7] font-bold whitespace-nowrap">
                    {cel(l.total, l)}
                  </td>
                )}
              </tr>
            ))}
            <tr>
              <td className="py-1.5 pr-2 text-label min-w-[6.5rem]">Resultado líquido s/ principal</td>
              {grupos.map((g) => (
                <td key={g.moeda} className={clsx("py-1.5 px-1.5 text-right tabular whitespace-nowrap", corValor(g.liquido))}>
                  {comSinal(g.liquido / g.principalBRL, (x) => fmtPct(x))}
                </td>
              ))}
              {grupos.length > 1 && (
                <td className={clsx("py-1.5 pl-1.5 text-right tabular bg-[#f5f6f7] font-bold whitespace-nowrap", corValor(total.liquido))}>
                  {comSinal(total.liquido / total.principalBRL, (x) => fmtPct(x))}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-label mt-2 leading-relaxed">
        IRPJ/CSLL provisionado contrato a contrato sobre o resultado positivo; contratos com resultado negativo não geram provisão (o efeito
        redutor no lucro real da empresa não é reconhecido nesta demonstração).
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tratamento contábil e fiscal
// ---------------------------------------------------------------------------

const LANCAMENTOS: { evento: string; debito: string; credito: string }[] = [
  { evento: "Remessa (PTAX da remessa)", debito: "Aplicações no exterior – time deposit", credito: "Bancos conta movimento (R$)" },
  { evento: "IOF câmbio na remessa", debito: "Despesa financeira – IOF", credito: "Bancos conta movimento (R$)" },
  { evento: "Tarifa bancária (SWIFT)", debito: "Despesas bancárias", credito: "Bancos conta movimento (R$)" },
  {
    evento: "Juros do mês – competência (TPM44)",
    debito: "Time deposit – juros a receber",
    credito: "Receita financeira – juros no exterior",
  },
  { evento: "Avaliação cambial – PTAX sobe (TPM1)", debito: "Time deposit", credito: "Receita financeira – variação cambial ativa" },
  { evento: "Avaliação cambial – PTAX cai (TPM1)", debito: "Despesa financeira – variação cambial passiva", credito: "Time deposit" },
  { evento: "Provisão de IRPJ/CSLL", debito: "Despesa de IRPJ/CSLL", credito: "IRPJ/CSLL a recolher (ou passivo fiscal diferido)" },
  { evento: "Resgate no vencimento (PTAX do resgate)", debito: "Bancos conta movimento (R$)", credito: "Time deposit (principal + juros)" },
];

function TratamentoContabil() {
  return (
    <Card title="Tratamento contábil e fiscal" subtitle="CPC 02 (R2) · CPC 48 · CPC 03 (R2) · CPC 32 · IRPJ/CSLL – lucro real">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
        <div className="space-y-4 text-[13px] text-text leading-relaxed min-w-0">
          <Bloco titulo="Conversão e mensuração – CPC 02 (R2) e CPC 48">
            <li>Reconhecimento inicial pela PTAX da remessa (taxa à vista da data da transação – CPC 02, item 21).</li>
            <li>
              Item monetário em moeda estrangeira: convertido em cada data-base pela PTAX de fechamento (venda, BCB – CPC 02, item 23). A
              diferença é variação cambial no resultado financeiro – <strong>ativa</strong> quando a PTAX sobe e <strong>passiva</strong>{" "}
              quando cai (CPC 02, item 28).
            </li>
            <li>
              Juros por competência como receita financeira (custo amortizado – CPC 48): juros simples ACT/360, pagos no vencimento. Os
              juros do mês são convertidos pela PTAX de fechamento do mês (aproximação da taxa média – CPC 02, item 22).
            </li>
            <li>
              IOF câmbio de {fmtPct(PARAM.iofCambio)} sobre a remessa e tarifa bancária de US$ {PARAM.tarifaUSD}: despesas na data da
              remessa. Imateriais, não integram a taxa efetiva; se relevantes, seriam custos de transação (CPC 48, item 5.1.1).
            </li>
          </Bloco>
          <Bloco titulo="Tributação">
            <li>
              Rendimento de aplicação no exterior de pessoa jurídica: <strong>sem IRRF</strong> no Brasil – compõe o lucro real (Lei
              9.249/1995, art. 25). IRPJ 15% + adicional 10% + CSLL 9% = {fmtPct(ALIQUOTA_IRPJ_CSLL, 0)}, provisionados sobre o resultado
              positivo (juros + variação cambial − IOF − tarifa).
            </li>
            <li>
              Variação cambial: regime de caixa (regra geral – MP 2.158-35/2001, art. 30) ou de competência (opção da empresa). No regime de
              caixa, a parcela da provisão relativa à variação cambial não realizada é IRPJ/CSLL diferido (CPC 32) até a liquidação.
            </li>
          </Bloco>
          <Bloco titulo="Fluxo de caixa – CPC 03 (R2)">
            <li>
              Remessa e resgate do principal: atividade de investimento (prazo original acima de 90 dias – não é equivalente de caixa).
            </li>
            <li>
              Juros recebidos no resgate: atividade operacional ou de investimento, conforme a política contábil da empresa (CPC 03, item
              33).
            </li>
            <li>
              Variação cambial não realizada: item não caixa, ajustado ao lucro no método indireto. A linha “efeito da variação cambial
              sobre o caixa e equivalentes de caixa” (item 28) só se aplica a depósitos classificados como equivalentes de caixa.
            </li>
          </Bloco>
        </div>
        <div className="space-y-4 min-w-0">
          <div>
            <h4 className="text-sm font-bold text-text mb-2">Lançamentos típicos</h4>
            <div className="rounded-lg border border-line-soft text-[13px]">
              <div className="hidden sm:grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 px-3 py-2 bg-[#f5f6f7] rounded-t-lg border-b border-line-soft font-semibold text-text">
                <span>Evento</span>
                <span>Débito</span>
                <span>Crédito</span>
              </div>
              <ul>
                {LANCAMENTOS.map((x, i) => (
                  <li
                    key={x.evento}
                    className={clsx(
                      "grid grid-cols-1 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-3 py-1.5 leading-snug",
                      i < LANCAMENTOS.length - 1 && "border-b border-line-soft",
                    )}
                  >
                    <span className="font-semibold text-text">{x.evento}</span>
                    <span className="text-text">
                      <span className="text-label font-semibold">D</span> {x.debito}
                    </span>
                    <span className="text-text">
                      <span className="text-label font-semibold">C</span> {x.credito}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Bloco titulo="No SAP TRM">
            <li>
              Contrato Money Market de depósito a prazo fixo (categoria de produto 510, FTR_CREATE); remessa, IOF, tarifa e resgate lançados
              com TBB1.
            </li>
            <li>Apropriação mensal dos juros: TPM44 (diferimento/apropriação).</li>
            <li>
              Avaliação cambial na data-chave: <strong>TPM1</strong>, com a PTAX importada na TCURR (tipo M) – gera a variação cambial ativa
              ou passiva do mês na moeda de avaliação (R$).
            </li>
          </Bloco>
        </div>
      </div>
    </Card>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="text-sm font-bold text-text mb-1.5">{titulo}</h4>
      <ul className="list-disc pl-5 space-y-1 text-[13px] text-text leading-relaxed marker:text-label">{children}</ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Painel de detalhe
// ---------------------------------------------------------------------------

interface Degrau {
  k: string;
  linhas: [string, string?];
  valor: number;
  tipo: "total" | "mais" | "menos";
  inicio: number;
  fim: number;
  /** rótulo em R$ mil (arredondado de modo que os degraus fechem com os totais) */
  rotulo: number;
}

/** Arredonda valores (já na unidade do rótulo) para inteiros que somem `alvo` – método do maior resto */
function ratear(v: number[], alvo: number): number[] {
  const out = v.map((x) => Math.floor(x));
  let dif = alvo - out.reduce((s, x) => s + x, 0);
  const ordem = v.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (let k = 0; dif > 0 && ordem.length; k++, dif--) out[ordem[k % ordem.length].i] += 1;
  for (let k = ordem.length - 1; dif < 0 && ordem.length; k--, dif++) out[ordem[((k % ordem.length) + ordem.length) % ordem.length].i] -= 1;
  return out;
}

function degraus(r: Resultado): Degrau[] {
  const dec = (v: number) => v / 100; // décimos de R$ mil
  const si = Math.round(dec(r.principalBRL));
  const ss = Math.round(dec(r.saldoBRL));
  const sf = Math.round(dec(r.principalBRL + r.liquido));
  const [rj, rv] = ratear([dec(r.juros), dec(r.vc)], ss - si);
  const [ri, rt, rir] = ratear([dec(-r.iof), dec(-r.tarifa), dec(-r.ir)], sf - ss);
  const out: Degrau[] = [];
  let nivel = 0;
  const total = (k: string, linhas: [string, string?], v: number, rot: number) => {
    nivel = v / 1000;
    out.push({ k, linhas, valor: v, tipo: "total", inicio: 0, fim: nivel, rotulo: rot / 10 });
  };
  const passo = (k: string, linhas: [string, string?], v: number, rot: number) => {
    const ini = nivel;
    nivel += v / 1000;
    out.push({ k, linhas, valor: v, tipo: v >= 0 ? "mais" : "menos", inicio: ini, fim: nivel, rotulo: rot / 10 });
  };
  total("principal", ["Principal", "na remessa"], r.principalBRL, si);
  passo("juros", ["Juros"], r.juros, rj);
  passo("vc", ["Variação", "cambial"], r.vc, rv);
  total("saldo", ["Saldo em R$"], r.saldoBRL, ss);
  passo("iof", ["IOF câmbio"], -r.iof, ri);
  passo("tarifa", ["Tarifa"], -r.tarifa, rt);
  passo("ir", ["IRPJ/CSLL"], -r.ir, rir);
  total("liquido", ["Principal +", "resultado líq."], r.principalBRL + r.liquido, sf);
  return out;
}

const COR_DEGRAU: Record<Degrau["tipo"], string> = { total: CHART_SEMANTIC.neutral, mais: CHART_SEMANTIC.good, menos: CHART_SEMANTIC.bad };

function Cascata({ r }: { r: Resultado }) {
  const ds = degraus(r);
  const niveis = ds.flatMap((d) => (d.tipo === "total" ? [d.fim] : [d.inicio, d.fim]));
  const min = Math.min(...niveis);
  const max = Math.max(...niveis);
  const amplitude = Math.max(max - min, 1);
  const bruto = amplitude / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= bruto) ?? 10 * mag;
  const lo = Math.max(0, Math.floor((min - amplitude * 0.35) / passo) * passo);
  const hi = Math.ceil((max + amplitude * 0.55) / passo) * passo;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + passo / 1000; v += passo) ticks.push(Math.round((v - lo) * 1000) / 1000);
  // Barras empilhadas: base transparente + degrau visível (eixo deslocado para começar em `lo`)
  const dados = ds.map((d) => ({
    ...d,
    base: d.tipo === "total" ? 0 : Math.min(d.inicio, d.fim) - lo,
    barra: d.tipo === "total" ? d.fim - lo : Math.abs(d.fim - d.inicio),
  }));
  const porChave = new Map(ds.map((d) => [d.k, d]));
  const casasEixo = passo < 1 ? 1 : 0;

  const tick = ({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value: string } }) => {
    const d = porChave.get(payload?.value ?? "");
    if (!d) return <g />;
    const [l1, l2] = d.linhas;
    return (
      <text x={x - 6} y={y} textAnchor="end" {...AXIS_STYLE} fontSize={11} fontWeight={d.tipo === "total" ? 700 : 400}>
        <tspan x={x - 6} dy={l2 ? -3 : 4}>
          {l1}
        </tspan>
        {l2 && (
          <tspan x={x - 6} dy={13}>
            {l2}
          </tspan>
        )}
      </text>
    );
  };

  const rotulo = (props: {
    x?: number | string;
    y?: number | string;
    width?: number | string;
    height?: number | string;
    index?: number;
  }) => {
    const d = ds[props.index ?? 0];
    if (!d) return null;
    const x = Number(props.x ?? 0) + Number(props.width ?? 0);
    const y = Number(props.y ?? 0) + Number(props.height ?? 0) / 2;
    const texto = d.tipo === "total" ? fmtDec(d.rotulo, 1) : Math.abs(d.valor) < 1 ? "–" : comSinal(d.rotulo, (v) => fmtDec(v, 1));
    return (
      <text
        x={x + 5}
        y={y}
        dy={4}
        textAnchor="start"
        fill="#1d2d3e"
        fontSize={11}
        fontFamily="72, Arial, sans-serif"
        fontWeight={d.tipo === "total" ? 700 : 600}
      >
        {texto}
      </text>
    );
  };

  return (
    <>
      <p className="text-xs text-label mb-1">R$ mil · eixo a partir de {fmtNum(lo)} (truncado para evidenciar as variações)</p>
      <div className="-ml-1" style={{ height: ds.length * 34 + 34 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} layout="vertical" barCategoryGap="20%" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke="#e5e5e5" />
            <XAxis
              type="number"
              domain={[0, hi - lo]}
              ticks={ticks}
              allowDataOverflow
              tickFormatter={(v: number) => fmtDec(v + lo, casasEixo)}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: "#a8b2bd" }}
            />
            <YAxis type="category" dataKey="k" tick={tick} tickLine={false} axisLine={false} width={88} interval={0} />
            {dados.slice(0, -1).map((d, i) => (
              <ReferenceLine
                key={d.k}
                segment={[
                  { x: d.fim - lo, y: d.k },
                  { x: d.fim - lo, y: dados[i + 1].k },
                ]}
                stroke="#788fa6"
                strokeDasharray="3 3"
                ifOverflow="hidden"
              />
            ))}
            <Tooltip
              cursor={{ fill: "#0070f2", fillOpacity: 0.05 }}
              content={({ active, payload }) => {
                const d = active && payload?.[0] ? (payload[0].payload as Degrau) : null;
                if (!d) return null;
                return (
                  <div style={tooltipStyle} className="bg-white px-3 py-2 shadow-fiori">
                    <div className="font-bold text-text">{d.linhas.filter(Boolean).join(" ")}</div>
                    <div className="tabular text-text mt-0.5">
                      {d.tipo === "total" ? fmtBRL(d.valor) : comSinal(d.valor, (v) => fmtBRL(v))}
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="base" stackId="c" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="barra" stackId="c" isAnimationActive={false} minPointSize={2} radius={[0, 3, 3, 0]}>
              {dados.map((d) => (
                <Cell key={d.k} fill={COR_DEGRAU[d.tipo]} />
              ))}
              <LabelList dataKey="barra" content={rotulo} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function DetalheTD({ l, p, onClose }: { l: LinhaTD; p: PremissasMercado; onClose: () => void }) {
  const { td, pos, r, resgate, liquidado, serie } = l;
  const ref = REFERENCIA[td.moeda];
  const prazoTotal = diffDays(td.dataAplicacao, td.vencimento);
  const somaJuros = serie.reduce((s, x) => s + (x.jurosMes ?? 0), 0);
  const somaVc = serie.reduce((s, x) => s + (x.vcMes ?? 0), 0);
  const ptaxRef = liquidado ? resgate.ptax : pos.ptax;
  return (
    <aside className="bg-white rounded-[var(--radius-card)] shadow-fiori-lg lg:shadow-fiori overflow-hidden self-auto lg:self-start flex flex-col fixed inset-x-4 bottom-4 top-[calc(4rem+env(safe-area-inset-top,0px))] z-30 lg:sticky lg:inset-auto lg:top-[4.25rem] lg:z-auto lg:max-h-[calc(100vh-5.5rem)]">
      <header className="px-4 pt-3.5 pb-3 border-b border-line-soft">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-label">
              Time deposit {td.id} · Transação {td.transacao}
            </div>
            <h3 className="text-lg font-bold text-text leading-snug">
              {td.banco} · {td.moeda}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-link hover:bg-hover" aria-label="Fechar detalhe">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <ObjectStatus inverted icon={false} state="information">
            {td.cpc48}
          </ObjectStatus>
          <Tag color={COR_MOEDA[td.moeda]}>{td.moeda}</Tag>
          <Tag>Rating {td.rating}</Tag>
          {liquidado ? (
            <ObjectStatus inverted state="neutral">
              Liquidado em {fmtDate(td.vencimento)}
            </ObjectStatus>
          ) : (
            <>
              <Tag>{pos.prazoRemanescente <= 365 ? "Circulante" : "Não circulante"}</Tag>
              {pos.prazoRemanescente <= 30 && (
                <ObjectStatus inverted state="critical">
                  Vence em {pos.prazoRemanescente} dias
                </ObjectStatus>
              )}
            </>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto fiori-scroll px-4 py-4 space-y-5">
        <section>
          <h4 className="text-sm font-bold text-text mb-2">Contrato</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Empresa">{`${td.empresa} – ${EMPRESAS[td.empresa]?.nome ?? ""}`}</Field>
            <Field label="Praça">{td.praca}</Field>
            <Field label="Principal (ME)">{fmtME(td.principal, td.moeda)}</Field>
            <Field label="Taxa (juros simples ACT/360)">{taxaTDTexto(td)}</Field>
            <Field label="Referência">{`${ref.nome} ${fmtPct(ref.taxa)} + ${fmtDec((td.taxa - ref.taxa) * 100, 2)} p.p.`}</Field>
            <Field label="Grupo econômico">{td.grupo}</Field>
            <Field label="Aplicação">{fmtDate(td.dataAplicacao)}</Field>
            <Field label="Vencimento">{`${fmtDate(td.vencimento)} (${prazoTotal} dias)`}</Field>
            <Field label="Portfolio">{td.portfolio}</Field>
            <Field label="Prazo remanescente">{liquidado ? "Liquidado" : `${pos.prazoRemanescente} dias`}</Field>
          </div>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text mb-2">{liquidado ? "Resgate realizado" : `Posição em ${fmtDate(p.dataBase)}`}</h4>
          <dl className="space-y-1.5 text-[13px]">
            <Linha
              label={liquidado ? "Valor resgatado (ME)" : "Saldo (ME)"}
              valor={fmtME(liquidado ? resgate.valorME : pos.saldoME, td.moeda)}
            />
            <Linha
              label={`Juros (ME) em ${liquidado ? prazoTotal : pos.diasCorridos} dias`}
              valor={fmtME(liquidado ? resgate.valorME - td.principal : pos.jurosME, td.moeda)}
              cor="text-positive"
            />
            <Linha label="PTAX da remessa" valor={fmtPtax(td.ptaxAplicacao)} />
            {!liquidado && (
              <Linha label={l.remessaNoMes ? "PTAX base do mês (remessa)" : "PTAX do mês anterior"} valor={fmtPtax(pos.ptaxMesAnterior)} />
            )}
            <Linha
              label={liquidado ? "PTAX do resgate" : "PTAX da data-base"}
              valor={`${fmtPtax(ptaxRef)} (${comSinal(ptaxRef / td.ptaxAplicacao - 1, (x) => fmtPct(x))})`}
            />
            <div className="border-t border-line-soft pt-1.5">
              <Linha label={liquidado ? "Resgate bruto (R$)" : "Saldo (R$)"} valor={fmtBRL(r.saldoBRL, true)} forte />
            </div>
            {!liquidado && (
              <Linha
                label="Variação cambial do mês"
                valor={comSinal(pos.variacaoCambialMes, (v) => fmtBRL(v, true))}
                cor={corValor(pos.variacaoCambialMes)}
              />
            )}
          </dl>
        </section>

        <section>
          <h4 className="text-sm font-bold text-text">Decomposição do resultado</h4>
          <Cascata r={r} />
          <dl className="space-y-1.5 text-[13px] mt-1">
            <Linha
              label="Resultado bruto (juros + variação cambial)"
              valor={comSinal(r.bruto, (v) => fmtBRL(v, true))}
              cor={corValor(r.bruto)}
            />
            <Linha label="Resultado líquido" valor={comSinal(r.liquido, (v) => fmtBRL(v, true))} cor={corValor(r.liquido)} forte />
            <Linha
              label="Resultado líquido s/ principal em R$"
              valor={comSinal(r.liquido / r.principalBRL, (v) => fmtPct(v))}
              cor={corValor(r.liquido)}
            />
          </dl>
        </section>

        {!liquidado && (
          <section>
            <h4 className="text-sm font-bold text-text mb-2">Resgate no vencimento (projetado)</h4>
            <dl className="space-y-1.5 text-[13px]">
              <Linha label={`Valor de resgate em ${fmtDate(resgate.data)}`} valor={fmtME(resgate.valorME, td.moeda)} />
              <Linha label="PTAX projetada (data-base)" valor={fmtPtax(resgate.ptax)} />
              <Linha label="Resgate bruto projetado (R$)" valor={fmtBRL(resgate.bruto, true)} forte />
            </dl>
            <p className="text-xs text-label leading-relaxed mt-2">
              Projeção com a PTAX da data-base – último dado disponível importado do SAP. A PTAX do fechamento de câmbio no vencimento
              definirá a variação cambial realizada.
            </p>
          </section>
        )}

        <section>
          <h4 className="text-sm font-bold text-text mb-2">Evolução mensal desde a aplicação</h4>
          <div className="overflow-x-auto fiori-scroll rounded-lg border border-line-soft">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr className="bg-[#f5f6f7] text-text">
                  <th className="text-left font-semibold px-1.5 pl-2 py-1.5 border-b border-line-soft whitespace-nowrap">Data · PTAX</th>
                  <th className="text-right font-semibold px-1.5 py-1.5 border-b border-line-soft whitespace-nowrap">
                    Saldo ({SIMBOLO[td.moeda]})
                  </th>
                  <th className="text-right font-semibold px-1.5 py-1.5 border-b border-line-soft whitespace-nowrap">Saldo (R$)</th>
                  <th className="text-right font-semibold px-1.5 py-1.5 border-b border-line-soft whitespace-nowrap">Juros mês</th>
                  <th className="text-right font-semibold px-1.5 pr-2 py-1.5 border-b border-line-soft whitespace-nowrap">VC mês</th>
                </tr>
              </thead>
              <tbody>
                {serie.map((s) => (
                  <tr key={`${s.evento}-${s.data}`}>
                    <td className="px-1.5 pl-2 py-1.5 border-b border-line-soft whitespace-nowrap">
                      <div className="text-text font-semibold">
                        {s.evento === "Fim de mês" ? fmtMonthShort(s.data) : `${s.evento} ${fmtDate(s.data).slice(0, 5)}`}
                      </div>
                      <div className="text-[11px] text-label tabular">{fmtPtax(s.ptax)}</div>
                    </td>
                    <td className="px-1.5 py-1.5 text-right tabular border-b border-line-soft whitespace-nowrap">{fmtDec(s.saldoME, 2)}</td>
                    <td className="px-1.5 py-1.5 text-right tabular border-b border-line-soft whitespace-nowrap">{fmtNum(s.saldoBRL)}</td>
                    <td className="px-1.5 py-1.5 text-right tabular border-b border-line-soft whitespace-nowrap">
                      {s.jurosMes === null ? "–" : fmtNum(s.jurosMes)}
                    </td>
                    <td
                      className={clsx(
                        "px-1.5 pr-2 py-1.5 text-right tabular border-b border-line-soft whitespace-nowrap",
                        s.vcMes !== null && corValor(s.vcMes),
                      )}
                    >
                      {s.vcMes === null ? "–" : comSinal(s.vcMes)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#f5f6f7] font-bold">
                  <td className="px-1.5 pl-2 py-1.5" colSpan={3}>
                    Total desde a remessa
                  </td>
                  <td className="px-1.5 py-1.5 text-right tabular whitespace-nowrap">{fmtNum(somaJuros)}</td>
                  <td className={clsx("px-1.5 pr-2 py-1.5 text-right tabular whitespace-nowrap", corValor(somaVc))}>{comSinal(somaVc)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-label leading-relaxed mt-2">
            Juros do mês convertidos pela PTAX de fim de mês; variação cambial do mês sobre o saldo em moeda (principal + juros) do mês
            anterior. Σ juros + Σ variação = {comSinal(somaJuros + somaVc, (v) => fmtBRL(v))} = resultado bruto. No acumulado da posição, os
            juros são convertidos pela PTAX {liquidado ? "do resgate" : "da data-base"} e a variação cambial é apurada sobre o principal –
            por isso as parcelas diferem, mas o total é o mesmo.
          </p>
        </section>
      </div>
    </aside>
  );
}

function Linha({ label, valor, forte, cor }: { label: string; valor: string; forte?: boolean; cor?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-label">{label}</dt>
      <dd className={clsx("tabular whitespace-nowrap", forte ? "font-bold text-text text-sm" : "text-text", cor)}>{valor}</dd>
    </div>
  );
}
