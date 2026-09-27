import clsx from "clsx";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../shared/components/fiori/Card";
import { FilterField, SegmentedButton, Select } from "../../shared/components/fiori/Inputs";
import { AXIS_STYLE, CHART_SEMANTIC, HeaderKpi, MicroBar } from "../../shared/components/fiori/Kpi";
import { MessageStrip } from "../../shared/components/fiori/MessageStrip";
import { ObjectStatus, semaforoState, type ValueState } from "../../shared/components/fiori/ObjectStatus";
import { ReportPage } from "../../shared/components/shell/ReportPage";
import { ptaxDoMes } from "../../shared/data/mercado";
import { fmtDate, fmtMonthLong, fmtMonthShort, lastMonthEnds, previousMonthEnd } from "../../shared/lib/dates";
import { exportarExcel } from "../../shared/lib/exportar";
import { fmtBRL, fmtCompact, fmtDec, fmtNum, fmtPct, plural } from "../../shared/lib/format";
import { ptaxNaData } from "../../shared/lib/taxas";
import { relatorioPorId } from "../data/catalogo";
import { FUNDOS, type Fundo } from "../data/fundos";
import { PARAMETROS_TIME_DEPOSIT, TIME_DEPOSITS, type TimeDeposit } from "../data/timeDeposits";
import { ESCOPOS, useMestre, type Escopo } from "../context/useDados";
import { COR_MOEDA, MOEDAS, rentabilidadeMestre, TIPOS_CONTRATO, type ContratoMestre, type Moeda } from "../lib/carteiraMestre";
import { avaliarPolitica, SEMAFORO_TEXTO, type Semaforo } from "../lib/indicadores";
import { posicaoTimeDeposit, ptaxTD, saldoME } from "../lib/timeDeposit";

const rel = relatorioPorId("r11");

const tooltipStyle = { backgroundColor: "#2e2e2e", border: "1px solid rgba(247, 243, 231, 0.13)", borderRadius: 0, color: "#f7f3e7", fontFamily: "Figtree, system-ui, sans-serif", fontSize: 12 };

type Visao = "contrato" | "exposicao";
type Medida = "curva" | "mercado" | "contabil" | "liquido";
type Periodo = "acumulado" | "mes";
type MoedaEst = "USD" | "EUR";

const MEDIDAS: { value: Medida; label: string; fn: (c: ContratoMestre) => number }[] = [
  { value: "curva", label: "Saldo bruto", fn: (c) => c.saldoCurva },
  { value: "mercado", label: "Saldo a mercado", fn: (c) => c.saldoMercado },
  { value: "contabil", label: "Valor contábil", fn: (c) => c.valorContabil },
  { value: "liquido", label: "Rendimento líquido", fn: (c) => c.rendimentoLiquido },
];

const VISOES: { value: Visao; label: string }[] = [
  { value: "contrato", label: "Moeda do contrato" },
  { value: "exposicao", label: "Exposição cambial" },
];

const MOEDAS_EST: MoedaEst[] = ["USD", "EUR"];
const MOEDA_NOME: Record<Moeda, string> = { BRL: "Real", USD: "Dólar americano", EUR: "Euro" };
const SIMBOLO: Record<Moeda, string> = { BRL: "R$", USD: "US$", EUR: "€" };
const CHOQUES = [-0.1, -0.05, 0.05, 0.1];

/** Fundos cambiais (cotas em R$, carteira indexada à moeda estrangeira) e time deposits, por código da Carteira-Mestre */
const FUNDO_CAMBIAL = new Map<string, { fundo: Fundo; moeda: MoedaEst }>(
  FUNDOS.flatMap((f) => (f.modelo.tipo === "cambial" ? [[f.id, { fundo: f, moeda: f.modelo.moeda }] as [string, { fundo: Fundo; moeda: MoedaEst }]] : [])),
);
const TD_POR_CODIGO = new Map<string, TimeDeposit>(TIME_DEPOSITS.map((td) => [td.id, td]));

/** Moeda de exposição econômica: a do contrato ou, no fundo cambial, a moeda que indexa a carteira */
function moedaExposicao(codigo: string, moedaContrato: Moeda): Moeda {
  return FUNDO_CAMBIAL.get(codigo)?.moeda ?? moedaContrato;
}

const moedaNaVisao = (c: ContratoMestre, v: Visao): Moeda => (v === "contrato" ? c.moeda : moedaExposicao(c.codigo, c.moeda));

function ptaxDB(m: Moeda, p: { ptaxUSD: number; ptaxEUR: number }): number {
  return m === "USD" ? p.ptaxUSD : m === "EUR" ? p.ptaxEUR : 1;
}

/** US$ 815,8 mil · € 403,5 mil */
function fmtMECompacto(v: number, m: Moeda): string {
  const abs = Math.abs(v);
  const sinal = v < 0 ? "−" : "";
  if (abs >= 1e6) return `${sinal}${SIMBOLO[m]} ${(abs / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (abs >= 1e3) return `${sinal}${SIMBOLO[m]} ${(abs / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `${sinal}${SIMBOLO[m]} ${fmtNum(abs)}`;
}

const fmtME = (v: number, m: Moeda) => `${SIMBOLO[m]} ${fmtDec(v, 2)}`;

interface Resultado {
  bruto: number;
  juros: number;
  vc: number;
  /** IOF câmbio realizado na remessa dos time deposits */
  iofCambio: number;
  /** IOF regressivo realizado em resgates com menos de 30 dias (renda fixa e fundos) */
  iofRegressivo: number;
  ir: number;
  taxas: number;
  liquido: number;
}

const zeroRes = (): Resultado => ({ bruto: 0, juros: 0, vc: 0, iofCambio: 0, iofRegressivo: 0, ir: 0, taxas: 0, liquido: 0 });

/** Linha de resultado por contrato, com a variação cambial nas duas visões */
interface LinhaRes {
  moedaContrato: Moeda;
  moedaExposicao: Moeda;
  bruto: number;
  /** variação cambial na moeda do contrato (time deposits) */
  vcContrato: number;
  /** variação cambial na exposição econômica (time deposits + fundo cambial) */
  vcExposicao: number;
  iofCambio: number;
  iofRegressivo: number;
  ir: number;
  taxas: number;
  liquido: number;
}

type PorMoeda<T> = Record<Moeda | "Total", T>;

function agregar(linhas: LinhaRes[], v: Visao): PorMoeda<Resultado> {
  const out = { BRL: zeroRes(), USD: zeroRes(), EUR: zeroRes(), Total: zeroRes() } as PorMoeda<Resultado>;
  for (const l of linhas) {
    const m = v === "contrato" ? l.moedaContrato : l.moedaExposicao;
    const vc = v === "contrato" ? l.vcContrato : l.vcExposicao;
    for (const k of [m, "Total"] as const) {
      const r = out[k];
      r.bruto += l.bruto;
      r.vc += vc;
      r.juros += l.bruto - vc;
      r.iofCambio += l.iofCambio;
      r.iofRegressivo += l.iofRegressivo;
      r.ir += l.ir;
      r.taxas += l.taxas;
      r.liquido += l.liquido;
    }
  }
  return out;
}

const semaforoCor: Record<Semaforo, string> = { ok: CHART_SEMANTIC.good, atencao: CHART_SEMANTIC.critical, excedido: CHART_SEMANTIC.bad };

function statusLimite(share: number, limite: number): Semaforo {
  return share > limite ? "excedido" : share >= limite * 0.8 ? "atencao" : "ok";
}

export function R11MoedaTipo() {
  const [escopo, setEscopo] = useState<Escopo>("todas");
  const { premissas: p, contratos } = useMestre(escopo);
  const [visao, setVisao] = useState<Visao>("contrato");
  const [medida, setMedida] = useState<Medida>("curva");
  const [periodo, setPeriodo] = useState<Periodo>("acumulado");

  const med = MEDIDAS.find((m) => m.value === medida)!;
  const inicioMes = previousMonthEnd(p.dataBase);

  // Base independente da visão: exposição econômica, resultados e sensibilidade
  const base = useMemo(() => {
    const total = contratos.reduce((s, c) => s + c.saldoCurva, 0);

    // Resultado desde a aplicação (posição na data-base)
    const acumulado: LinhaRes[] = contratos.map((c) => {
      const td = TD_POR_CODIGO.get(c.codigo);
      const fc = FUNDO_CAMBIAL.get(c.codigo);
      let vcContrato = 0;
      let vcExposicao = 0;
      if (td) {
        vcContrato = vcExposicao = posicaoTimeDeposit(td, p.dataBase, p).variacaoCambial;
      } else if (fc) {
        // cota em R$ ∝ PTAX: variação cambial sobre o valor aplicado, da PTAX da aplicação à PTAX da data-base
        const ptax0 = ptaxNaData(fc.moeda, fc.fundo.dataAplicacao, p);
        vcExposicao = c.principalBRL * (ptaxDB(fc.moeda, p) / ptax0 - 1);
      }
      return {
        moedaContrato: c.moeda,
        moedaExposicao: moedaExposicao(c.codigo, c.moeda),
        bruto: c.rendimentoBruto,
        vcContrato,
        vcExposicao,
        // a Carteira-Mestre traz só IOF realizado: nos time deposits, o IOF câmbio da remessa
        iofCambio: td ? c.iof : 0,
        iofRegressivo: td ? 0 : c.iof,
        ir: c.ir,
        taxas: c.taxas,
        liquido: c.rendimentoLiquido,
      };
    });

    // Resultado no mês (inclui contratos liquidados no mês) – motor de rentabilidade da Carteira-Mestre
    const mes: LinhaRes[] = rentabilidadeMestre(inicioMes, p.dataBase, p, escopo).map((r) => {
      const td = TD_POR_CODIGO.get(r.codigo);
      const fc = FUNDO_CAMBIAL.get(r.codigo);
      let vcContrato = 0;
      let vcExposicao = 0;
      if (td) {
        const pos = posicaoTimeDeposit(td, p.dataBase, p);
        if (pos.ativo) vcContrato = pos.variacaoCambialMes;
        else {
          // liquidado no mês: saldo em moeda no início do mês × variação da PTAX até o vencimento
          const aplicadoNoMes = td.dataAplicacao > inicioMes;
          const baseME = aplicadoNoMes ? td.principal : saldoME(td, inicioMes);
          const ptaxBase = aplicadoNoMes ? td.ptaxAplicacao : ptaxTD(td, inicioMes, p);
          vcContrato = baseME * (ptaxTD(td, r.fim, p) - ptaxBase);
        }
        vcExposicao = vcContrato;
      } else if (fc) {
        const ptaxBase = fc.fundo.dataAplicacao > inicioMes ? ptaxNaData(fc.moeda, fc.fundo.dataAplicacao, p) : ptaxNaData(fc.moeda, inicioMes, p);
        vcExposicao = r.base * (ptaxNaData(fc.moeda, r.fim, p) / ptaxBase - 1);
      }
      return {
        moedaContrato: r.moeda,
        moedaExposicao: moedaExposicao(r.codigo, r.moeda),
        bruto: r.rendimento,
        vcContrato,
        vcExposicao,
        iofCambio: td ? r.iof : 0,
        iofRegressivo: td ? 0 : r.iof,
        ir: r.ir,
        taxas: r.taxas,
        liquido: r.rendLiquido,
      };
    });

    // Exposição cambial econômica (time deposits + fundo cambial) – mesma regra "exterior" da política
    const exp = { USD: { brl: 0, me: 0, td: 0, fundo: 0 }, EUR: { brl: 0, me: 0, td: 0, fundo: 0 } };
    for (const c of contratos) {
      const m = moedaExposicao(c.codigo, c.moeda);
      if (m === "BRL") continue;
      exp[m].brl += c.saldoCurva;
      const me = c.moeda === m ? c.saldoME : c.saldoCurva / ptaxDB(m, p);
      exp[m].me += me;
      if (c.moeda === m) exp[m].td += me;
      else exp[m].fundo += me;
    }
    const expTotal = exp.USD.brl + exp.EUR.brl;
    // Visão moeda do contrato: só contratos em moeda estrangeira (time deposits) – a mesma base do R10
    const ctr = { USD: { brl: 0, me: 0 }, EUR: { brl: 0, me: 0 } };
    for (const c of contratos) {
      if (c.moeda === "BRL") continue;
      ctr[c.moeda].brl += c.saldoCurva;
      ctr[c.moeda].me += c.saldoME;
    }
    const ctrTotal = ctr.USD.brl + ctr.EUR.brl;
    const politica = avaliarPolitica(contratos).find((r) => r.id === "exterior")!;
    const vcMesEconomica = mes.reduce((s, l) => s + l.vcExposicao, 0);
    const vcMesTD = mes.reduce((s, l) => s + l.vcContrato, 0);

    // Conferência independente: saldo em moeda dos time deposits (motor do R10)
    const tdME = { USD: 0, EUR: 0 };
    for (const td of TIME_DEPOSITS) {
      if (escopo !== "todas" && td.empresa !== escopo) continue;
      const pos = posicaoTimeDeposit(td, p.dataBase, p);
      if (pos.ativo) tdME[td.moeda] += pos.saldoME;
    }
    const fundosCambiais = contratos.filter((c) => FUNDO_CAMBIAL.has(c.codigo));

    return { total, acumulado, mes, exp, expTotal, ctr, ctrTotal, politica, vcMesEconomica, vcMesTD, tdME, fundosCambiais };
  }, [contratos, p, escopo, inicioMes]);

  // Quadros que dependem da visão e da medida
  const d = useMemo(() => {
    const matriz = TIPOS_CONTRATO.map((t) => {
      const cel = { BRL: 0, USD: 0, EUR: 0, Total: 0 } as PorMoeda<number>;
      const me = { USD: 0, EUR: 0 };
      for (const c of contratos.filter((x) => x.tipo === t.tipo)) {
        const m = moedaNaVisao(c, visao);
        const v = med.fn(c);
        cel[m] += v;
        cel.Total += v;
        if (m !== "BRL") me[m] += c.moeda === m ? c.saldoME : c.saldoCurva / ptaxDB(m, p);
      }
      return { ...t, cel, me };
    });
    const totalCel = { BRL: 0, USD: 0, EUR: 0, Total: 0 } as PorMoeda<number>;
    const totalME = { USD: 0, EUR: 0 };
    for (const l of matriz) {
      for (const k of [...MOEDAS, "Total"] as const) totalCel[k] += l.cel[k];
      for (const m of MOEDAS_EST) totalME[m] += l.me[m];
    }
    const conferencia = contratos.reduce((s, c) => s + med.fn(c), 0);

    const porMoeda = MOEDAS.map((m) => {
      const cs = contratos.filter((c) => moedaNaVisao(c, visao) === m);
      const curva = cs.reduce((s, c) => s + c.saldoCurva, 0);
      const mercado = cs.reduce((s, c) => s + c.saldoMercado, 0);
      return { moeda: m, qtd: cs.length, curva, mercado, mtm: mercado - curva, contabil: cs.reduce((s, c) => s + c.valorContabil, 0) };
    });
    const tCurva = porMoeda.reduce((s, x) => s + x.curva, 0);
    const tMercado = porMoeda.reduce((s, x) => s + x.mercado, 0);

    const TRATAMENTO: Record<string, string> = {
      "Custo Amortizado": "Não contabilizado – valor justo só em nota explicativa",
      "VJ por ORA": "Contabilizado no PL (outros resultados abrangentes)",
      "VJ por Resultado": "Contabilizado no resultado do período",
    };
    const mtmPorCpc = Object.keys(TRATAMENTO).map((cpc) => {
      const cs = contratos.filter((c) => c.cpc48 === cpc);
      return { cpc, qtd: cs.length, mtm: cs.reduce((s, c) => s + c.mtm, 0), tratamento: TRATAMENTO[cpc] };
    }).filter((x) => x.qtd > 0);

    return {
      mtmPorCpc,
      matriz,
      totalCel,
      totalME,
      conferencia,
      porMoeda,
      totalMoeda: { curva: tCurva, mercado: tMercado, mtm: tMercado - tCurva },
      resAcumulado: agregar(base.acumulado, visao),
      resMes: agregar(base.mes, visao),
    };
  }, [contratos, visao, med, p, base]);

  const escopoLabel = ESCOPOS.find((e) => e.value === escopo)!.label;
  const visaoLabel = VISOES.find((v) => v.value === visao)!.label;
  const ptaxAnterior = (m: MoedaEst) => ptaxNaData(m, inicioMes, p);
  const res = periodo === "acumulado" ? d.resAcumulado : d.resMes;
  const expShare = base.total > 0 ? base.expTotal / base.total : 0;
  const ctrShare = base.total > 0 ? base.ctrTotal / base.total : 0;
  const temFundoCambial = base.exp.USD.fundo > 0 || base.exp.EUR.fundo > 0;
  // KPIs do cabeçalho seguem a visão: moeda do contrato = time deposits (mesma base do R10); exposição = + fundo cambial
  const vcMesKpi = visao === "contrato" ? base.vcMesTD : base.vcMesEconomica;
  const matrizOk = Math.abs(d.conferencia - d.totalCel.Total) < 0.005;
  const linhaTD = d.matriz.find((l) => l.tipo === "Time deposit");
  const tdOk = !!linhaTD && MOEDAS_EST.every((m) => Math.abs(linhaTD.me[m] - base.tdME[m]) < 0.005);
  const pol = base.politica;
  const utilizacao = pol.limite > 0 ? pol.share / pol.limite : 0;
  const medidaDonut = medida === "liquido" ? MEDIDAS[0] : med;

  // linhas "(−)" mostram o valor positivo (o sinal está no rótulo); IOF regressivo só aparece quando houver
  const temIofRegressivo = [...MOEDAS, "Total" as const].some((k) => Math.round(d.resAcumulado[k].iofRegressivo) !== 0 || Math.round(d.resMes[k].iofRegressivo) !== 0);
  const linhasResultado: { rotulo: string; fn: (r: Resultado) => number; forte?: boolean; recuo?: boolean }[] = [
    { rotulo: "Rendimento bruto", fn: (r) => r.bruto, forte: true },
    { rotulo: "Juros / rendimento", fn: (r) => r.juros, recuo: true },
    { rotulo: "Variação cambial", fn: (r) => r.vc, recuo: true },
    { rotulo: "(−) IOF câmbio (remessa)", fn: (r) => r.iofCambio },
    ...(temIofRegressivo ? [{ rotulo: "(−) IOF regressivo (resgate < 30 dias)", fn: (r: Resultado) => r.iofRegressivo }] : []),
    { rotulo: "(−) IR/IRRF · IRPJ/CSLL nos TDs", fn: (r) => r.ir },
    { rotulo: "(−) Taxas e tarifas", fn: (r) => r.taxas },
    { rotulo: "(=) Rendimento líquido", fn: (r) => r.liquido, forte: true },
  ];

  const sens = useMemo(() => {
    const linhas = MOEDAS_EST.map((m) => ({ moeda: m, brl: base.exp[m].brl, me: base.exp[m].me, efeitos: CHOQUES.map((s) => base.exp[m].brl * s) }));
    const total = { brl: base.expTotal, efeitos: CHOQUES.map((s) => base.expTotal * s) };
    const participacao = CHOQUES.map((s) => {
      const t = base.total + base.expTotal * s;
      return t > 0 ? (base.expTotal * (1 + s)) / t : 0;
    });
    const grafico = CHOQUES.map((s) => ({
      cenario: `PTAX ${s > 0 ? "+" : "−"}${fmtDec(Math.abs(s) * 100, 0)}%`,
      USD: (base.exp.USD.brl * s) / 1e3,
      EUR: (base.exp.EUR.brl * s) / 1e3,
    }));
    return { linhas, total, participacao, grafico };
  }, [base]);

  const exportar = () => {
    const sub = `${escopoLabel} · Visão: ${visaoLabel}`;
    exportarExcel(
      `R11_Moeda_Tipo_${p.dataBase}.xlsx`,
      [
        {
          nome: "Matriz R$",
          titulo: `R11 – Moeda × tipo de contrato: ${med.label.toLowerCase()} (R$)`,
          subtitulo: sub,
          colunas: [
            { titulo: "Tipo de contrato", largura: 24 },
            { titulo: "BRL (R$)", tipo: "moeda" },
            { titulo: "USD (R$)", tipo: "moeda" },
            { titulo: "EUR (R$)", tipo: "moeda" },
            { titulo: "Total (R$)", tipo: "moeda" },
            { titulo: "% do total", tipo: "pct", largura: 12 },
          ],
          linhas: d.matriz.map((l) => [l.tipo, l.cel.BRL, l.cel.USD, l.cel.EUR, l.cel.Total, d.totalCel.Total !== 0 ? l.cel.Total / d.totalCel.Total : 0]),
          total: ["TOTAL", d.totalCel.BRL, d.totalCel.USD, d.totalCel.EUR, d.totalCel.Total, 1],
          notas: [
            `% do total por moeda: BRL ${fmtPct(d.totalCel.BRL / (d.totalCel.Total || 1), 1)} · USD ${fmtPct(d.totalCel.USD / (d.totalCel.Total || 1), 1)} · EUR ${fmtPct(d.totalCel.EUR / (d.totalCel.Total || 1), 1)}.`,
            "Visão exposição cambial: o fundo cambial (cotas em R$, carteira indexada ao dólar) é tratado como exposição em USD.",
          ],
        },
        {
          nome: "Matriz ME",
          titulo: "R11 – Saldo em moeda original (saldo bruto)",
          subtitulo: sub,
          colunas: [{ titulo: "Tipo de contrato / indicador", largura: 34 }, { titulo: "USD", tipo: "decimal", largura: 18 }, { titulo: "EUR", tipo: "decimal", largura: 18 }],
          linhas: [
            ...d.matriz.map((l) => [l.tipo, l.me.USD, l.me.EUR]),
            ["Total em moeda original", d.totalME.USD, d.totalME.EUR],
            [`PTAX da data-base (${fmtDate(p.dataBase)})`, fmtDec(p.ptaxUSD, 4), fmtDec(p.ptaxEUR, 4)],
            [`PTAX do mês anterior (${fmtDate(inicioMes)})`, fmtDec(ptaxAnterior("USD"), 4), fmtDec(ptaxAnterior("EUR"), 4)],
            ["Equivalente em R$ (× PTAX da data-base)", d.totalME.USD * p.ptaxUSD, d.totalME.EUR * p.ptaxEUR],
          ],
          notas: ["Time deposits: principal + juros ACT/360 na moeda original. Fundo cambial (visão exposição): saldo em R$ ÷ PTAX da data-base."],
        },
        {
          nome: "Curva x mercado",
          titulo: "R11 – Curva × mercado por moeda (R$)",
          subtitulo: sub,
          colunas: [
            { titulo: "Moeda", largura: 12 },
            { titulo: "Contratos", tipo: "inteiro", largura: 10 },
            { titulo: "Saldo na curva", tipo: "moeda" },
            { titulo: "Saldo a mercado", tipo: "moeda" },
            { titulo: "Ajuste MTM", tipo: "moeda" },
            { titulo: "Ágio/deságio (%)", tipo: "pct", largura: 14 },
          ],
          linhas: d.porMoeda.map((x) => [x.moeda, x.qtd, x.curva, x.mercado, x.mtm, x.curva > 0 ? x.mtm / x.curva : 0]),
          total: ["TOTAL", contratos.length, d.totalMoeda.curva, d.totalMoeda.mercado, d.totalMoeda.mtm, d.totalMoeda.curva > 0 ? d.totalMoeda.mtm / d.totalMoeda.curva : 0],
        },
        {
          nome: "Resultado por moeda",
          titulo: "R11 – Resultado por moeda (R$)",
          subtitulo: sub,
          colunas: [{ titulo: "Linha", largura: 36 }, { titulo: "BRL", tipo: "moeda" }, { titulo: "USD", tipo: "moeda" }, { titulo: "EUR", tipo: "moeda" }, { titulo: "Total", tipo: "moeda" }],
          linhas: [
            ["DESDE A APLICAÇÃO (até a data-base)"],
            ...linhasResultado.map((l) => [l.rotulo, ...(["BRL", "USD", "EUR", "Total"] as const).map((k) => l.fn(d.resAcumulado[k]))]),
            [],
            [`NO MÊS (${fmtMonthLong(p.dataBase)})`],
            ...linhasResultado.map((l) => [l.rotulo, ...(["BRL", "USD", "EUR", "Total"] as const).map((k) => l.fn(d.resMes[k]))]),
          ],
          notas: [
            "Time deposits: juros convertidos pela PTAX da data-base e variação cambial sobre o principal (acumulada) ou sobre o saldo em moeda do fim do mês anterior (no mês); IR = provisão de IRPJ/CSLL (34%).",
            `IOF câmbio (remessa) = IOF realizado de ${fmtPct(PARAMETROS_TIME_DEPOSIT.iofCambio)} na remessa dos time deposits (Decreto 6.306/2007, art. 15-B, XXI-A, red. Decreto 12.499/2025). Linhas (−) em valor positivo; IR do mês negativo = reversão de provisão.`,
            "No mês: rendimento do período pelo motor de rentabilidade da Carteira-Mestre (inclui contratos liquidados no mês).",
          ],
        },
        {
          nome: "Sensibilidade",
          titulo: "R11 – Sensibilidade cambial: efeito em R$ de choques na PTAX",
          subtitulo: `${escopoLabel} · Exposição cambial econômica (time deposits e fundo cambial)`,
          colunas: [
            { titulo: "Moeda", largura: 30 },
            { titulo: "Exposição (R$)", tipo: "moeda" },
            { titulo: "Exposição (ME)", tipo: "decimal" },
            ...CHOQUES.map((s) => ({ titulo: `PTAX ${s > 0 ? "+" : "−"}${fmtDec(Math.abs(s) * 100, 0)}%`, tipo: "moeda" as const })),
          ],
          linhas: [
            ...sens.linhas.map((l) => [l.moeda, l.brl, l.me, ...l.efeitos]),
            ["Participação da exposição na carteira", "", "", ...sens.participacao],
          ],
          total: ["TOTAL (USD + EUR)", sens.total.brl, "", ...sens.total.efeitos],
          notas: [
            `Limite da política de investimentos (exposição cambial): máx. ${fmtPct(pol.limite, 0)}; atenção a partir de ${fmtPct(pol.limite * 0.8, 0)}. Atual: ${fmtPct(pol.share, 2)} (${SEMAFORO_TEXTO[pol.status]}).`,
            "Choques instantâneos sobre a PTAX da data-base (último dado disponível importado do SAP), antes de tributos.",
          ],
        },
      ],
      p.dataBase,
    );
  };

  const seriePtax = lastMonthEnds(p.dataBase, 12).map((fim) => ({ mes: fmtMonthShort(fim), USD: ptaxDoMes("USD", fim.slice(0, 7)), EUR: ptaxDoMes("EUR", fim.slice(0, 7)) }));
  const minPtax = Math.floor(Math.min(...seriePtax.map((x) => Math.min(x.USD, x.EUR))) * 2) / 2;
  const maxPtax = Math.ceil(Math.max(...seriePtax.map((x) => Math.max(x.USD, x.EUR))) * 2) / 2;
  const eixoPtax = Array.from({ length: Math.round((maxPtax - minPtax) / 0.5) + 1 }, (_, i) => minPtax + i * 0.5);
  const fundo = base.fundosCambiais[0];
  const fundoPtax0 = fundo ? ptaxNaData(FUNDO_CAMBIAL.get(fundo.codigo)!.moeda, fundo.dataAplicacao, p) : 0;

  return (
    <ReportPage
      relatorio={rel}
      onExport={exportar}
      kpis={
        <div className="flex flex-wrap gap-x-8 gap-y-3 xl:grid xl:grid-cols-3">
          <HeaderKpi
            label="Carteira em R$"
            value={fmtCompact(base.total)}
            sub={`saldo bruto · ${plural(contratos.length, "contrato", "contratos")}`}
          />
          {visao === "contrato" ? (
            <HeaderKpi
              label="Contratos em moeda estrangeira"
              value={fmtCompact(base.ctrTotal)}
              sub={
                base.expTotal !== base.ctrTotal
                  ? `${fmtPct(ctrShare, 1)} da carteira · c/ fundo cambial: ${fmtCompact(base.expTotal)}`
                  : `${fmtPct(ctrShare, 1)} da carteira · time deposits`
              }
            />
          ) : (
            <HeaderKpi
              label="Exposição cambial"
              value={fmtCompact(base.expTotal)}
              sub={`${fmtPct(expShare, 1)} da carteira${temFundoCambial ? " · c/ fundo cambial" : ""}`}
            />
          )}
          {MOEDAS_EST.map((m) => {
            const me = visao === "contrato" ? base.ctr[m].me : base.exp[m].me;
            const comFundo = visao === "exposicao" && base.exp[m].fundo > 0;
            return (
              <HeaderKpi
                key={m}
                label={`${m} (ME)`}
                value={fmtMECompacto(me, m)}
                sub={`PTAX ${fmtDec(ptaxDB(m, p), 4)}${comFundo ? " · inclui fundo cambial" : ""}`}
              />
            );
          })}
          <HeaderKpi
            label="Variação cambial do mês"
            value={fmtCompact(vcMesKpi)}
            state={Math.round(vcMesKpi) < 0 ? "negative" : Math.round(vcMesKpi) > 0 ? "positive" : "neutral"}
            sub={
              Math.round(base.vcMesEconomica - base.vcMesTD) === 0
                ? fmtMonthLong(p.dataBase)
                : visao === "contrato"
                  ? `exposição cambial (c/ fundo cambial): ${fmtCompact(base.vcMesEconomica)}`
                  : `moeda do contrato (time deposits): ${fmtCompact(base.vcMesTD)}`
            }
          />
          <HeaderKpi
            label="Uso do limite cambial"
            value={fmtPct(utilizacao, 0)}
            state={semaforoState(pol.status)}
            sub={`política: ${fmtPct(pol.share, 1)} da carteira · limite ${fmtPct(pol.limite, 0)}`}
          />
        </div>
      }
    >
      <div className="bg-surface rounded-[var(--radius-card)] shadow-fiori px-4 py-3 no-print">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3 lg:gap-6">
          <FilterField label="Empresa" className="lg:w-80">
            <Select value={escopo} onChange={setEscopo} options={ESCOPOS} />
          </FilterField>
          <GrupoFiltro label="Visão">
            <div>
              <SegmentedButton value={visao} onChange={setVisao} items={VISOES} />
            </div>
          </GrupoFiltro>
          <GrupoFiltro label="Medida da matriz">
            <div className="sm:hidden">
              <Select value={medida} onChange={setMedida} options={MEDIDAS.map((m) => ({ value: m.value, label: m.label }))} ariaLabel="Medida da matriz" />
            </div>
            <div className="hidden sm:block">
              <SegmentedButton value={medida} onChange={setMedida} items={MEDIDAS.map((m) => ({ value: m.value, label: m.label }))} />
            </div>
          </GrupoFiltro>
        </div>
      </div>

      <MessageStrip design="information">
        {fundo ? (
          visao === "exposicao" ? (
            <>
              <strong>Visão exposição cambial:</strong> o fundo cambial {fundo.produto} ({fundo.codigo}) tem cotas em R$, mas a carteira é
              indexada ao dólar – aqui ele é tratado como exposição em USD: saldo em USD = saldo em R$ ÷ PTAX da data-base (
              {fmtDec(p.ptaxUSD, 4)}); variação cambial estimada sobre o valor aplicado desde a PTAX da aplicação ({fmtDec(fundoPtax0, 4)}).
              Mesmo critério da regra “Exposição cambial” da política de investimentos (R07).
            </>
          ) : (
            <>
              <strong>Visão moeda do contrato:</strong> o fundo cambial {fundo.produto} ({fundo.codigo}) é um contrato em R$ e aparece na
              coluna BRL, embora a carteira do fundo seja indexada ao dólar. Alterne para <strong>Exposição cambial</strong> para tratá-lo
              como exposição em USD, como faz a política de investimentos.
            </>
          )
        ) : (
          <>
            Não há fundo cambial na carteira {escopo === "todas" ? "nesta data-base" : "desta empresa na data-base"}: as visões moeda do
            contrato e exposição cambial coincidem (a exposição em moeda estrangeira vem só dos time deposits).
          </>
        )}
      </MessageStrip>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card
          className="xl:col-span-2 min-w-0"
          title="Matriz moeda × tipo de contrato (R$)"
          subtitle={`${med.label} · ${visaoLabel.toLowerCase()} · % do total em cinza`}
          bodyClassName="px-0 pb-0"
        >
          <div className="overflow-x-auto fiori-scroll">
            <table className="w-full text-sm border-separate border-spacing-0 min-w-[560px]">
              <thead>
                <tr>
                  <Th left className="sticky left-0 z-[2] pl-4 min-w-[170px]">Tipo de contrato</Th>
                  {MOEDAS.map((m) => (
                    <Th key={m}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COR_MOEDA[m] }} />
                        {m}
                      </span>
                    </Th>
                  ))}
                  <Th className="bg-surface-3 pr-4">Total</Th>
                </tr>
              </thead>
              <tbody>
                {d.matriz.map((l) => (
                  <tr key={l.tipo}>
                    <td className="sticky left-0 z-[1] bg-surface pl-4 pr-3 py-2 border-b border-line-soft">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: l.cor }} />
                        <div className="min-w-0">
                          <div className="font-semibold text-text whitespace-nowrap">{l.tipo}</div>
                          <div className="text-xs text-label">{l.origem}</div>
                        </div>
                      </div>
                    </td>
                    {MOEDAS.map((m) => (
                      <CelulaMatriz key={m} valor={l.cel[m]} total={d.totalCel.Total} />
                    ))}
                    <CelulaMatriz valor={l.cel.Total} total={d.totalCel.Total} forte />
                  </tr>
                ))}
                <tr>
                  <td className="sticky left-0 z-[1] bg-surface-3 pl-4 pr-3 py-2 font-bold text-text border-t border-line">Total</td>
                  {MOEDAS.map((m) => (
                    <CelulaMatriz key={m} valor={d.totalCel[m]} total={d.totalCel.Total} forte rodape />
                  ))}
                  <CelulaMatriz valor={d.totalCel.Total} total={d.totalCel.Total} forte rodape />
                </tr>
              </tbody>
            </table>
          </div>
          <Conferencia ok={matrizOk}>
            Total da matriz {matrizOk ? "igual à" : "diverge da"} Σ {med.label.toLowerCase()} da Carteira-Mestre:{" "}
            <strong>{fmtBRL(d.conferencia, true)}</strong>
            {matrizOk ? " (diferença 0,00)" : ` (diferença ${fmtBRL(d.conferencia - d.totalCel.Total, true)})`}
          </Conferencia>
        </Card>

        <Card title="Matriz em moeda original" subtitle={`Saldo bruto em USD e EUR · ${visaoLabel.toLowerCase()}`} bodyClassName="px-0 pb-0" className="min-w-0">
          <div className="overflow-x-auto fiori-scroll">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <Th left className="pl-4">Tipo de contrato</Th>
                  <Th>USD</Th>
                  <Th className="pr-4">EUR</Th>
                </tr>
              </thead>
              <tbody>
                {d.matriz
                  .filter((l) => l.me.USD !== 0 || l.me.EUR !== 0)
                  .map((l) => (
                    <tr key={l.tipo}>
                      <td className="pl-4 pr-3 py-2 border-b border-line-soft text-text whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: l.cor }} />
                          {l.tipo}
                        </span>
                      </td>
                      <TdNum>{l.me.USD ? fmtME(l.me.USD, "USD") : "–"}</TdNum>
                      <TdNum className="pr-4">{l.me.EUR ? fmtME(l.me.EUR, "EUR") : "–"}</TdNum>
                    </tr>
                  ))}
                {d.totalME.USD === 0 && d.totalME.EUR === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-label border-b border-line-soft">
                      Sem contratos em moeda estrangeira nesta seleção
                    </td>
                  </tr>
                )}
                <tr className="font-bold">
                  <td className="pl-4 pr-3 py-2 bg-surface-3 border-b border-line-soft">Total em moeda original</td>
                  <TdNum className="bg-surface-3">{d.totalME.USD ? fmtME(d.totalME.USD, "USD") : "–"}</TdNum>
                  <TdNum className="bg-surface-3 pr-4">{d.totalME.EUR ? fmtME(d.totalME.EUR, "EUR") : "–"}</TdNum>
                </tr>
                <tr>
                  <td className="pl-4 pr-3 py-2 border-b border-line-soft text-label">
                    PTAX {fmtDate(p.dataBase)}
                    <div className="text-xs">data-base</div>
                  </td>
                  <TdNum>{fmtDec(p.ptaxUSD, 4)}</TdNum>
                  <TdNum className="pr-4">{fmtDec(p.ptaxEUR, 4)}</TdNum>
                </tr>
                <tr>
                  <td className="pl-4 pr-3 py-2 border-b border-line-soft text-label">
                    PTAX {fmtDate(inicioMes)}
                    <div className="text-xs">fim do mês anterior</div>
                  </td>
                  <TdNum>{fmtDec(ptaxAnterior("USD"), 4)}</TdNum>
                  <TdNum className="pr-4">{fmtDec(ptaxAnterior("EUR"), 4)}</TdNum>
                </tr>
                <tr>
                  <td className="pl-4 pr-3 py-2 border-b border-line-soft text-label">Variação da PTAX no mês</td>
                  {MOEDAS_EST.map((m) => {
                    const v = ptaxDB(m, p) / ptaxAnterior(m) - 1;
                    return (
                      <TdNum key={m} className={clsx(m === "EUR" && "pr-4", Math.round(v * 1e4) < 0 ? "text-negative" : "text-positive")}>
                        {v > 0 ? "+" : ""}
                        {fmtPct(v)}
                      </TdNum>
                    );
                  })}
                </tr>
                <tr>
                  <td className="pl-4 pr-3 py-2 text-label">Equivalente em R$</td>
                  <TdNum className="border-b-0">{fmtNum(d.totalME.USD * p.ptaxUSD, { dash: true })}</TdNum>
                  <TdNum className="border-b-0 pr-4">{fmtNum(d.totalME.EUR * p.ptaxEUR, { dash: true })}</TdNum>
                </tr>
              </tbody>
            </table>
          </div>
          <Conferencia ok={tdOk}>
            Linha Time deposit {tdOk ? "igual ao" : "diverge do"} R10 (Σ saldo em moeda dos TDs): {fmtME(base.tdME.USD, "USD")} ·{" "}
            {fmtME(base.tdME.EUR, "EUR")}
            {visao === "exposicao" && base.exp.USD.fundo > 0 && <> · + fundo cambial {fmtME(base.exp.USD.fundo, "USD")}</>}
          </Conferencia>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2 min-w-0" title="Moeda × tipo de contrato" subtitle={`${med.label} em R$ milhões, empilhado por tipo de contrato · ${visaoLabel.toLowerCase()}`}>
          <div className="h-[22rem] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={MOEDAS.map((m) => ({
                  moeda: m,
                  total: d.totalCel[m],
                  ...Object.fromEntries(d.matriz.map((l, i) => [`t${i}`, l.cel[m] / 1e6])),
                }))}
                stackOffset="sign"
                margin={{ top: 22, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="#3f3f3d" />
                <XAxis dataKey="moeda" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: "#575653" }} />
                <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={44} unit=" mi" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtBRL(v * 1e6), n]} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Figtree, system-ui, sans-serif" }} iconType="circle" iconSize={8} />
                <ReferenceLine y={0} stroke="#575653" />
                {d.matriz.map((l, i) => (
                  <Bar key={l.tipo} dataKey={`t${i}`} name={l.tipo} stackId="m" fill={l.cor} maxBarSize={96} isAnimationActive={false}>
                    {i === d.matriz.length - 1 && (
                      <LabelList dataKey="total" position="top" style={{ fontSize: 12, fill: "#f7f3e7", fontFamily: "Figtree, system-ui, sans-serif", fontWeight: 600 }} formatter={(v: number) => (Math.round(v) === 0 ? "" : fmtCompact(v))} />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Por moeda" subtitle={`${medidaDonut.label} · ${visaoLabel.toLowerCase()}`}>
          <DonutMoeda
            fatias={MOEDAS.map((m) => ({
              moeda: m,
              valor: contratos.filter((c) => moedaNaVisao(c, visao) === m).reduce((s, c) => s + medidaDonut.fn(c), 0),
            }))}
          />
          {medida === "liquido" && <p className="text-xs text-label mt-3">Com a medida rendimento líquido, o gráfico mostra a composição do saldo bruto.</p>}
          <div className="mt-4 pt-3 border-t border-line-soft">
            <div className="text-[13px] font-bold text-text">PTAX de fim de mês – 12 meses</div>
            <div className="text-xs text-label">Série importada do SAP (TCURR, tipo M) · R$ por unidade</div>
            <div className="h-44 mt-2 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={seriePtax} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#3f3f3d" />
                  <XAxis dataKey="mes" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#575653" }} interval={2} />
                  <YAxis tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={false} width={40} domain={[eixoPtax[0], eixoPtax[eixoPtax.length - 1]]} ticks={eixoPtax} tickFormatter={(v: number) => fmtDec(v, 1)} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtDec(v, 4), n]} />
                  <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Figtree, system-ui, sans-serif" }} iconType="circle" iconSize={8} />
                  <Line dataKey="USD" name="USD" stroke={COR_MOEDA.USD} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="EUR" name="EUR" stroke={COR_MOEDA.EUR} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="Curva × mercado por moeda" subtitle={`Saldo na curva, a mercado e ajuste MTM (R$) · ${visaoLabel.toLowerCase()}`} bodyClassName="px-0 pb-0" className="min-w-0">
          <div className="overflow-x-auto fiori-scroll">
            <table className="w-full text-sm border-separate border-spacing-0 min-w-[520px]">
              <thead>
                <tr>
                  <Th left className="pl-4">Moeda</Th>
                  <Th>Saldo na curva</Th>
                  <Th>Saldo a mercado</Th>
                  <Th>Ajuste MTM</Th>
                  <Th className="pr-4">Ágio/deságio</Th>
                </tr>
              </thead>
              <tbody>
                {d.porMoeda.map((x) => (
                  <tr key={x.moeda}>
                    <td className="pl-4 pr-3 py-2 border-b border-line-soft whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COR_MOEDA[x.moeda] }} />
                        <span className="font-semibold text-text">{x.moeda}</span>
                        <span className="text-xs text-label">{x.qtd} contr.</span>
                      </span>
                    </td>
                    <TdNum>{fmtNum(x.curva, { dash: true })}</TdNum>
                    <TdNum>{fmtNum(x.mercado, { dash: true })}</TdNum>
                    <TdNum className={corSinal(x.mtm)}>{fmtNum(x.mtm, { dash: true })}</TdNum>
                    <TdNum className={clsx("pr-4", corSinal(x.mtm))}>{x.curva > 0 ? fmtPct(x.mtm / x.curva) : "–"}</TdNum>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="pl-4 pr-3 py-2 bg-surface-3">Total</td>
                  <TdNum className="bg-surface-3 border-b-0">{fmtNum(d.totalMoeda.curva)}</TdNum>
                  <TdNum className="bg-surface-3 border-b-0">{fmtNum(d.totalMoeda.mercado)}</TdNum>
                  <TdNum className={clsx("bg-surface-3 border-b-0", corSinal(d.totalMoeda.mtm))}>{fmtNum(d.totalMoeda.mtm)}</TdNum>
                  <TdNum className={clsx("bg-surface-3 border-b-0 pr-4", corSinal(d.totalMoeda.mtm))}>
                    {d.totalMoeda.curva > 0 ? fmtPct(d.totalMoeda.mtm / d.totalMoeda.curva) : "–"}
                  </TdNum>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-line-soft">
            <div className="text-[13px] font-bold text-text mb-2">Ajuste MTM por classificação CPC 48</div>
            <ul className="space-y-2">
              {d.mtmPorCpc.map((x) => (
                <li key={x.cpc} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-[13px]">
                  <div className="min-w-0">
                    <span className="font-semibold text-text">{x.cpc}</span>
                    <span className="text-label"> · {x.qtd} contr.</span>
                    <div className="text-xs text-label">{x.tratamento}</div>
                  </div>
                  <span className={clsx("tabular whitespace-nowrap self-center", corSinal(x.mtm))}>{fmtNum(x.mtm, { dash: true })}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="px-4 py-3 text-xs text-label leading-relaxed border-t border-line-soft">
            MTM vem da renda fixa bancária (ágio/deságio informado) e dos títulos públicos (taxas indicativas ANBIMA). Fundos (valor da
            cota) e time deposits (saldo em moeda × PTAX da data-base) não têm curva distinta do mercado.
          </p>
        </Card>

        <Card
          title="Resultado por moeda"
          subtitle={periodo === "acumulado" ? `Desde a aplicação até ${fmtDate(p.dataBase)} (R$)` : `No mês – ${fmtMonthLong(p.dataBase)} (R$)`}
          bodyClassName="px-0 pb-0"
          className="min-w-0"
        >
          <div className="px-4 pb-3">
            <SegmentedButton
              value={periodo}
              onChange={setPeriodo}
              items={[
                { value: "acumulado", label: "Desde a aplicação" },
                { value: "mes", label: "No mês" },
              ]}
            />
          </div>
          <div className="overflow-x-auto fiori-scroll">
            <table className="w-full text-sm border-separate border-spacing-0 min-w-[560px]">
              <thead>
                <tr>
                  <Th left className="pl-4">Resultado</Th>
                  {MOEDAS.map((m) => (
                    <Th key={m}>{m}</Th>
                  ))}
                  <Th className="bg-surface-3 pr-4">Total</Th>
                </tr>
              </thead>
              <tbody>
                {linhasResultado.map((l) => (
                  <tr key={l.rotulo} className={l.forte ? "font-bold" : undefined}>
                    <td className={clsx("pr-3 py-2 border-b border-line-soft whitespace-nowrap", l.recuo ? "pl-8 text-label" : "pl-4 text-text", l.forte && "bg-surface-3")}>
                      {l.rotulo}
                    </td>
                    {([...MOEDAS, "Total"] as const).map((k) => {
                      const v = l.fn(res[k]);
                      const cor = l.forte || (l.recuo && l.rotulo === "Variação cambial") ? corSinal(v) : undefined;
                      return (
                        <TdNum
                          key={k}
                          className={clsx(
                            (l.forte || k === "Total") && "bg-surface-3",
                            k === "Total" && "pr-4 font-semibold",
                            cor ?? (l.recuo && "text-label"),
                          )}
                        >
                          {fmtNum(v, { dash: true })}
                        </TdNum>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-label leading-relaxed border-t border-line-soft">
            {periodo === "acumulado"
              ? "Time deposits: juros em moeda convertidos pela PTAX da data-base e variação cambial sobre o principal (PTAX da remessa → PTAX da data-base); IR = provisão de IRPJ/CSLL (34%) sobre o resultado positivo."
              : `Rendimento de ${fmtDate(inicioMes)} a ${fmtDate(p.dataBase)} pelo motor de rentabilidade da Carteira-Mestre (inclui contratos liquidados no mês). Time deposits: variação cambial do mês sobre o saldo em moeda do fim do mês anterior; IR do mês negativo = reversão de provisão.`}{" "}
            IOF câmbio (remessa): IOF realizado de {fmtPct(PARAMETROS_TIME_DEPOSIT.iofCambio)} na remessa dos time deposits para investimento no exterior
            {periodo === "mes" ? " feita no mês" : ""}
            {temIofRegressivo ? "; IOF regressivo: realizado em resgates de renda fixa e fundos com menos de 30 dias" : ""}. Linhas (−) em valor positivo.{" "}
            {visao === "exposicao" && fundo ? "Fundo cambial: variação cambial estimada pela variação da PTAX sobre o saldo aplicado; o restante é o cupom cambial líquido da taxa de administração." : ""}
          </p>
        </Card>
      </div>

      <Card
        title="Sensibilidade cambial"
        subtitle="Efeito em R$ de choques instantâneos na PTAX da data-base sobre a exposição cambial econômica (time deposits e fundo cambial), antes de tributos"
        bodyClassName="px-0 pb-0"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-5">
          <div className="min-w-0">
            <div className="overflow-x-auto fiori-scroll">
              <table className="w-full text-sm border-separate border-spacing-0 min-w-[600px]">
                <thead>
                  <tr>
                    <Th left className="pl-4">Moeda</Th>
                    <Th>Exposição</Th>
                    {CHOQUES.map((s) => (
                      <Th key={s} className={s === CHOQUES[CHOQUES.length - 1] ? "pr-4" : undefined}>
                        {s > 0 ? "+" : "−"}
                        {fmtDec(Math.abs(s) * 100, 0)}%
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sens.linhas.map((l) => (
                    <tr key={l.moeda}>
                      <td className="pl-4 pr-3 py-2 border-b border-line-soft whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COR_MOEDA[l.moeda] }} />
                          <div>
                            <div className="font-semibold text-text">{l.moeda}</div>
                            <div className="text-xs text-label">
                              {fmtME(l.me, l.moeda)} · PTAX {fmtDec(ptaxDB(l.moeda, p), 4)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <TdNum>{fmtNum(l.brl, { dash: true })}</TdNum>
                      {l.efeitos.map((v, i) => (
                        <TdNum key={i} className={clsx(i === CHOQUES.length - 1 && "pr-4", corSinal(v))}>
                          {fmtNum(v, { dash: true })}
                        </TdNum>
                      ))}
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="pl-4 pr-3 py-2 bg-surface-3 border-b border-line-soft">Total USD + EUR</td>
                    <TdNum className="bg-surface-3">{fmtNum(sens.total.brl, { dash: true })}</TdNum>
                    {sens.total.efeitos.map((v, i) => (
                      <TdNum key={i} className={clsx("bg-surface-3", i === CHOQUES.length - 1 && "pr-4", corSinal(v))}>
                        {fmtNum(v, { dash: true })}
                      </TdNum>
                    ))}
                  </tr>
                  <tr>
                    <td className="pl-4 pr-3 py-2 text-label whitespace-nowrap">Participação na carteira</td>
                    <TdNum className="border-b-0">
                      <ParticipacaoLimite share={expShare} limite={pol.limite} />
                    </TdNum>
                    {sens.participacao.map((v, i) => (
                      <TdNum key={i} className={clsx("border-b-0", i === CHOQUES.length - 1 && "pr-4")}>
                        <ParticipacaoLimite share={v} limite={pol.limite} />
                      </TdNum>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mx-4 my-4 rounded-lg border border-line-soft px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-text">Limite da política de investimentos</div>
                  <div className="text-xs text-label">
                    {pol.regra}: máx. {fmtPct(pol.limite, 0)} · atenção a partir de {fmtPct(pol.limite * 0.8, 0)} (80% do limite)
                  </div>
                </div>
                <ObjectStatus state={semaforoState(pol.status)}>{SEMAFORO_TEXTO[pol.status]}</ObjectStatus>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <MicroBar value={pol.share} max={pol.limite * 1.25} marker={pol.limite} color={semaforoCor[pol.status]} className="flex-1 h-2" />
                <span className="tabular text-[13px] font-semibold text-text whitespace-nowrap">
                  {fmtPct(pol.share, 2)} <span className="font-normal text-label">· {fmtPct(utilizacao, 0)} do limite</span>
                </span>
              </div>
              <p className="text-xs text-label mt-2">
                Exposição de {fmtBRL(pol.valor)} sobre carteira de {fmtBRL(base.total)}. Com PTAX +10%, a participação iria a{" "}
                {fmtPct(sens.participacao[CHOQUES.length - 1], 2)} ({SEMAFORO_TEXTO[statusLimite(sens.participacao[CHOQUES.length - 1], pol.limite)].toLowerCase()}).
              </p>
            </div>
          </div>
          <div className="min-w-0 px-4 pb-4 lg:pl-0">
            <div className="text-[13px] text-label mb-1">Efeito por cenário (R$ mil)</div>
            <div className="h-64 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sens.grafico} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#3f3f3d" />
                  <XAxis dataKey="cenario" tick={{ ...AXIS_STYLE, fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#575653" }} interval={0} />
                  <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={48} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtBRL(v * 1e3), n]} />
                  <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Figtree, system-ui, sans-serif" }} iconType="circle" iconSize={8} />
                  <ReferenceLine y={0} stroke="#575653" />
                  <Bar dataKey="USD" name="USD" stackId="s" fill={COR_MOEDA.USD} maxBarSize={56} isAnimationActive={false} />
                  <Bar dataKey="EUR" name="EUR" stackId="s" fill={COR_MOEDA.EUR} maxBarSize={56} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-label mt-2 leading-relaxed">
              Alta da PTAX (real mais fraco) aumenta o valor em R$ da exposição; queda reduz. Efeito bruto, antes de IRPJ/CSLL (34%) e
              sem hedge. PTAX da data-base = último dado disponível importado do SAP.
            </p>
          </div>
        </div>
      </Card>
    </ReportPage>
  );
}

/** Grupo da barra de filtros para controles que não são campos de formulário (SegmentedButton): div, não <label> */
function GrupoFiltro({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1 min-w-0">
      <span className="text-[13px] text-label">{label}</span>
      {children}
    </div>
  );
}

function corSinal(v: number): string | undefined {
  const r = Math.round(v);
  return r < 0 ? "text-negative" : r > 0 ? "text-positive" : undefined;
}

function Th({ children, className, left }: { children: ReactNode; className?: string; left?: boolean }) {
  return (
    <th className={clsx("bg-surface-2 px-3 py-2.5 text-text border-b-2 border-brand whitespace-nowrap", left ? "text-left" : "text-right", className)}>
      {children}
    </th>
  );
}

function TdNum({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={clsx("px-3 py-2 text-right tabular text-[13px] border-b border-line-soft whitespace-nowrap", className)}>{children}</td>;
}

function CelulaMatriz({ valor, total, forte, rodape }: { valor: number; total: number; forte?: boolean; rodape?: boolean }) {
  const zero = Math.round(valor) === 0;
  return (
    <td
      className={clsx(
        "px-3 py-2 text-right tabular text-[13px] whitespace-nowrap",
        rodape ? "bg-surface-3 border-t border-line" : "border-b border-line-soft",
        forte && !rodape && "bg-surface-3",
        forte && "font-bold",
      )}
    >
      {zero ? (
        <span className="text-label font-normal">–</span>
      ) : (
        <>
          <div className={clsx("text-text", valor < 0 && "text-negative")}>{fmtNum(valor)}</div>
          <div className="text-xs text-label font-normal">{fmtPct(total !== 0 ? valor / total : 0, 1)}</div>
        </>
      )}
    </td>
  );
}

function Conferencia({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icone = ok ? CheckCircle2 : AlertTriangle;
  return (
    <div className="px-4 py-2.5 border-t border-line-soft text-xs text-label flex items-start gap-1.5">
      <Icone className={clsx("w-3.5 h-3.5 shrink-0 mt-px", ok ? "text-positive" : "text-negative")} />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function ParticipacaoLimite({ share, limite }: { share: number; limite: number }) {
  const st = statusLimite(share, limite);
  const cor: Record<Semaforo, ValueState> = { ok: "positive", atencao: "critical", excedido: "negative" };
  return (
    <ObjectStatus state={cor[st]} icon={st !== "ok"}>
      {fmtPct(share, 2)}
    </ObjectStatus>
  );
}

function DonutMoeda({ fatias }: { fatias: { moeda: Moeda; valor: number }[] }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const visiveis = fatias.filter((f) => f.valor > 0);
  return (
    <div className="flex items-center gap-4">
      <div className="w-36 h-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={visiveis} dataKey="valor" nameKey="moeda" innerRadius="58%" outerRadius="100%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
              {visiveis.map((f) => (
                <Cell key={f.moeda} fill={COR_MOEDA[f.moeda]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [fmtCompact(v), n]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex-1 min-w-0 space-y-2.5">
        {fatias.map((f) => (
          <li key={f.moeda} className="text-[13px]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COR_MOEDA[f.moeda] }} />
              <span className="font-semibold text-text">{f.moeda}</span>
              <span className="text-label truncate flex-1">{MOEDA_NOME[f.moeda]}</span>
              <span className="tabular font-semibold text-text">{fmtPct(total !== 0 ? f.valor / total : 0, 1)}</span>
            </div>
            <div className="pl-[1.125rem] text-xs text-label tabular">{fmtCompact(f.valor)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
