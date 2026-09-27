import type { PremissasMercado as Premissas } from "../../shared/data/mercado";
import { addDays, diffDays, endOfMonth, fromDay, isBusinessDay, toDay } from "../../shared/lib/dates";
import { cdiAnual, chavePremissas, ptaxNaData } from "../../shared/lib/taxas";
import { RETORNOS_MENSAIS, type Fundo } from "../data/fundos";
import { COME_COTAS } from "../data/tributacao";
import { aliquotaIOF, aliquotaIR } from "./finance";

/**
 * R09 – Motor de fundos de investimento: cota diária líquida de taxas (administração e performance), come-cotas no
 * último dia útil de maio e novembro (15% fundos de longo prazo, 20% curto prazo; ações sem come-cotas), IR
 * complementar no resgate (tabela regressiva ou 22,5%/20% no curto prazo; 15% em ações) e IOF regressivo até D+29.
 * Até a data-base valem as séries importadas do SAP (CDI, retornos mensais, PTAX); depois, o último dado disponível.
 */

interface SerieCota {
  d0: number;
  /** cota ao fim de cada dia corrido (índice 0 = data da aplicação) */
  cota: Float64Array;
  /** taxas (adm + performance) acumuladas por cota, em R$ */
  taxaPorCota: Float64Array;
}

const cacheSerie = new Map<string, SerieCota>();

function diasUteisDoMes(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  let n = 0;
  for (let d = toDay(`${mes}-01`), e = toDay(endOfMonth(y, m)); d <= e; d++) if (isBusinessDay(d)) n++;
  return n;
}

/** Cristalização da taxa de performance: último dia útil de junho e de dezembro (dias em número) */
function datasCristalizacao(de: string, ate: string): number[] {
  const out: number[] = [];
  for (let y = Number(de.slice(0, 4)); y <= Number(ate.slice(0, 4)); y++) {
    for (const m of [6, 12]) {
      let d = toDay(endOfMonth(y, m));
      while (!isBusinessDay(d)) d--;
      out.push(d);
    }
  }
  return out;
}

function horizonte(f: Fundo, p: Premissas): string {
  return f.dataResgate ?? addDays(p.dataBase > "2026-03-31" ? p.dataBase : "2026-03-31", 400);
}

function serieCota(f: Fundo, p: Premissas): SerieCota {
  const k = `${f.id}|${chavePremissas(p)}`;
  const hit = cacheSerie.get(k);
  if (hit) return hit;
  const d0 = toDay(f.dataAplicacao);
  const n = toDay(horizonte(f, p)) - d0;
  const cota = new Float64Array(n + 1);
  const taxaPorCota = new Float64Array(n + 1);
  cota[0] = f.cotaAplicacao;
  const mesBase = p.dataBase.slice(0, 7);
  const ptax0 = f.modelo.tipo === "cambial" ? ptaxNaData(f.modelo.moeda, f.dataAplicacao, p) : 1;
  let fatorBruto = 1;
  let fatorLiquido = 1;
  let taxaAc = 0;
  // performance (CVM 175): provisão diária de taxaPerf × excedente da cota (líquida de adm.) sobre a cota-base
  // corrigida pelo benchmark, nunca abaixo da última cota cristalizada (linha-d'água); revertida se o excedente cai;
  // cristalizada no último dia útil de junho e dezembro
  let cotaAdm = f.cotaAplicacao;
  let cotaBase = f.cotaAplicacao;
  let fatorBench = 1;
  let admAc = 0;
  let perfCristal = 0;
  let provisao = 0;
  const cristaliza = new Set(datasCristalizacao(f.dataAplicacao, fromDay(d0 + n)));
  for (let i = 1; i <= n; i++) {
    const dia = d0 + i - 1; // o dia útil `dia` rende de `dia` para `dia + 1`
    let c = cota[i - 1];
    if (f.modelo.tipo === "cambial") {
      // cota = cota inicial × variação da PTAX × cupom cambial líquido da taxa de administração
      if (isBusinessDay(dia)) {
        fatorBruto *= Math.pow(1 + f.modelo.cupom, 1 / 252);
        fatorLiquido *= Math.pow(1 + f.modelo.cupom, 1 / 252) * Math.pow(1 - f.taxaAdm, 1 / 252);
      }
      const fx = ptaxNaData(f.modelo.moeda, fromDay(dia + 1), p) / ptax0;
      c = f.cotaAplicacao * fx * fatorLiquido;
      taxaAc = f.cotaAplicacao * fx * (fatorBruto - fatorLiquido);
    } else {
      if (isBusinessDay(dia)) {
        const di = Math.pow(1 + cdiAnual(dia, p), 1 / 252) - 1;
        let bruto: number;
        let bench = 1 + di;
        const m = f.modelo;
        if (m.tipo === "pctCDI") bruto = 1 + di * m.pctBruto;
        else if (m.tipo === "cdiMais") bruto = (1 + di) * Math.pow(1 + m.spread, 1 / 252);
        else {
          const mes = fromDay(dia).slice(0, 7);
          const r = RETORNOS_MENSAIS[m.serie][mes];
          if (r === undefined || mes > mesBase) {
            bruto = (1 + di) * Math.pow(1 + m.projecaoSpreadCDI, 1 / 252);
            // Ibovespa sem projeção: o fundo de ações é projetado "em linha" com o próprio índice (sem performance)
            if (m.serie === "ibovespa") bench = bruto;
          } else {
            const du = diasUteisDoMes(mes);
            bruto = Math.pow(1 + r + m.alfaMensal, 1 / du);
            if (m.serie === "ibovespa") bench = Math.pow(1 + r, 1 / du);
          }
        }
        const fatorAdm = Math.pow(1 - f.taxaAdm, 1 / 252);
        admAc += cotaAdm * bruto * (1 - fatorAdm);
        cotaAdm = cotaAdm * bruto * fatorAdm;
        fatorBench *= bench;
      }
      if (f.taxaPerf > 0) {
        const alvo = Math.max(cotaBase * fatorBench, cotaBase);
        provisao = f.taxaPerf * Math.max(0, cotaAdm - alvo);
        if (cristaliza.has(dia + 1) && provisao > 0) {
          // cristalização: a provisão vira taxa paga, a cota-base passa a ser a cota do dia
          cotaAdm -= provisao;
          perfCristal += provisao;
          provisao = 0;
          cotaBase = cotaAdm;
          fatorBench = 1;
        } else if (cristaliza.has(dia + 1)) {
          fatorBench = 1;
          cotaBase = Math.max(cotaBase, cotaAdm);
        }
      }
      c = cotaAdm - provisao;
      taxaAc = admAc + perfCristal + provisao;
    }
    cota[i] = c;
    taxaPorCota[i] = taxaAc;
  }
  const s = { d0, cota, taxaPorCota };
  cacheSerie.set(k, s);
  return s;
}

/** Cota do fundo ao fim do dia `iso` */
export function cotaFundo(f: Fundo, iso: string, p: Premissas): number {
  const s = serieCota(f, p);
  const i = Math.min(Math.max(0, toDay(iso) - s.d0), s.cota.length - 1);
  return s.cota[i];
}

/** Datas de come-cotas (último dia útil de maio e novembro) em (de, ate] */
export function datasComeCotas(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let y = Number(de.slice(0, 4)); y <= Number(ate.slice(0, 4)); y++) {
    for (const m of COME_COTAS.meses) {
      let d = toDay(endOfMonth(y, m));
      while (!isBusinessDay(d)) d--;
      const iso = fromDay(d);
      if (iso > de && iso <= ate) out.push(iso);
    }
  }
  return out;
}

export interface EventoComeCotas {
  data: string;
  cota: number;
  cotaReferencia: number;
  quantidadeAntes: number;
  /** rendimento tributado no evento (R$) */
  base: number;
  aliquota: number;
  /** IR recolhido com a redução da quantidade de cotas */
  ir: number;
  quantidadeDepois: number;
}

export interface ResgateFundo {
  data: string;
  cota: number;
  quantidade: number;
  bruto: number;
  /** rendimento total desde a aplicação (inclui o já tributado no come-cotas) */
  rendimento: number;
  iof: number;
  /** IR complementar retido no resgate (IR total − come-cotas já recolhido) */
  irComplementar: number;
  liquido: number;
}

export interface HistoricoFundo {
  quantidadeInicial: number;
  comeCotas: EventoComeCotas[];
  resgate: ResgateFundo | null;
}

const cacheHist = new Map<string, HistoricoFundo>();

function aliquotaComeCotas(f: Fundo): number {
  if (f.regimeIR === "Fundo de ações (15%)") return 0;
  return f.regimeIR === "Fundo CP (come-cotas 20%)" ? COME_COTAS.aliquotaCP : COME_COTAS.aliquotaLP;
}

/** Come-cotas e resgate ao longo da vida do fundo (histórico até a data-base; projeção depois dela) */
export function historicoFundo(f: Fundo, p: Premissas): HistoricoFundo {
  const k = `${f.id}|${chavePremissas(p)}`;
  const hit = cacheHist.get(k);
  if (hit) return hit;
  const quantidadeInicial = f.valorAplicado / f.cotaAplicacao;
  let qtd = quantidadeInicial;
  let ref = f.cotaAplicacao;
  const aliq = aliquotaComeCotas(f);
  const comeCotas: EventoComeCotas[] = [];
  const fim = f.dataResgate ?? horizonte(f, p);
  if (aliq > 0) {
    for (const d of datasComeCotas(f.dataAplicacao, f.dataResgate ? addDays(f.dataResgate, -1) : fim)) {
      const cota = cotaFundo(f, d, p);
      const base = Math.max(0, cota - ref) * qtd;
      const ir = base * aliq;
      const depois = qtd - ir / cota;
      comeCotas.push({ data: d, cota, cotaReferencia: ref, quantidadeAntes: qtd, base, aliquota: aliq, ir, quantidadeDepois: depois });
      qtd = depois;
      if (cota > ref) ref = cota;
    }
  }
  let resgate: ResgateFundo | null = null;
  if (f.dataResgate) {
    const cota = cotaFundo(f, f.dataResgate, p);
    const bruto = qtd * cota;
    const pagos = comeCotas.reduce((s, e) => s + e.ir, 0);
    const rendimento = bruto + pagos - f.valorAplicado;
    const dias = diffDays(f.dataAplicacao, f.dataResgate);
    const iof = f.regimeIR === "Fundo de ações (15%)" ? 0 : Math.max(0, rendimento) * aliquotaIOF(dias);
    const irTotal = Math.max(0, rendimento - iof) * aliquotaIR(dias, f.regimeIR);
    const irComplementar = Math.max(0, irTotal - pagos);
    resgate = { data: f.dataResgate, cota, quantidade: qtd, bruto, rendimento, iof, irComplementar, liquido: bruto - iof - irComplementar };
  }
  const h = { quantidadeInicial, comeCotas, resgate };
  cacheHist.set(k, h);
  return h;
}

export interface PosicaoFundo {
  f: Fundo;
  data: string;
  ativo: boolean;
  diasCorridos: number;
  cota: number;
  quantidade: number;
  saldo: number;
  /** IR recolhido no come-cotas até a data */
  comeCotasPago: number;
  /** saldo + come-cotas recolhido − valor aplicado */
  rendimentoBruto: number;
  iof: number;
  aliquotaIR: number;
  /** IR total devido se resgatado na data (come-cotas + complementar) */
  irTotal: number;
  irComplementar: number;
  rendimentoLiquido: number;
  /** taxas de administração e performance cobradas na cota desde a aplicação (R$) */
  taxas: number;
  /** rendimento que o IR antecipado no come-cotas teria gerado até a data (custo de oportunidade) */
  custoComeCotas: number;
  rentabBruta: number;
  rentabLiquida: number;
  proximoComeCotas: string | null;
  liquidezImediata: boolean;
}

export function posicaoFundo(f: Fundo, iso: string, p: Premissas): PosicaoFundo {
  const ativo = f.dataAplicacao <= iso && (!f.dataResgate || iso < f.dataResgate);
  const h = historicoFundo(f, p);
  const ccAte = h.comeCotas.filter((e) => e.data <= iso);
  const quantidade = ccAte.length ? ccAte[ccAte.length - 1].quantidadeDepois : h.quantidadeInicial;
  const cota = cotaFundo(f, iso, p);
  const saldo = ativo ? quantidade * cota : 0;
  const comeCotasPago = ccAte.reduce((s, e) => s + e.ir, 0);
  const diasCorridos = Math.max(0, diffDays(f.dataAplicacao, iso));
  const rendimentoBruto = ativo ? saldo + comeCotasPago - f.valorAplicado : 0;
  const iof = ativo && f.regimeIR !== "Fundo de ações (15%)" ? Math.max(0, rendimentoBruto) * aliquotaIOF(diasCorridos) : 0;
  const aliq = aliquotaIR(diasCorridos, f.regimeIR);
  const irTotal = ativo ? Math.max(0, rendimentoBruto - iof) * aliq : 0;
  const irComplementar = Math.max(0, irTotal - comeCotasPago);
  // taxas cobradas: por período entre eventos, quantidade × variação da taxa acumulada por cota
  const s = serieCota(f, p);
  const idx = (d: string) => Math.min(Math.max(0, toDay(d) - s.d0), s.taxaPorCota.length - 1);
  let taxas = 0;
  let qtd = h.quantidadeInicial;
  let de = f.dataAplicacao;
  for (const e of ccAte) {
    taxas += qtd * (s.taxaPorCota[idx(e.data)] - s.taxaPorCota[idx(de)]);
    qtd = e.quantidadeDepois;
    de = e.data;
  }
  // até a data (fundo ativo) ou até o resgate (fundo já resgatado)
  const ateTaxas = ativo ? iso : f.dataResgate && iso >= f.dataResgate ? f.dataResgate : null;
  if (ateTaxas) taxas += qtd * (s.taxaPorCota[idx(ateTaxas)] - s.taxaPorCota[idx(de)]);
  const custoComeCotas = ativo ? ccAte.reduce((acc, e) => acc + e.ir * (cota / e.cota - 1), 0) : 0;
  const proximo = datasComeCotas(iso, addDays(iso, 200))[0] ?? null;
  return {
    f,
    data: iso,
    ativo,
    diasCorridos,
    cota,
    quantidade: ativo ? quantidade : 0,
    saldo,
    comeCotasPago,
    rendimentoBruto,
    iof,
    aliquotaIR: aliq,
    irTotal,
    irComplementar,
    rendimentoLiquido: rendimentoBruto - iof - irTotal,
    taxas,
    custoComeCotas,
    rentabBruta: f.valorAplicado > 0 ? rendimentoBruto / f.valorAplicado : 0,
    rentabLiquida: f.valorAplicado > 0 ? (rendimentoBruto - iof - irTotal) / f.valorAplicado : 0,
    proximoComeCotas: ativo && aliquotaComeCotas(f) > 0 ? proximo : null,
    liquidezImediata: f.diasResgate <= 1,
  };
}
