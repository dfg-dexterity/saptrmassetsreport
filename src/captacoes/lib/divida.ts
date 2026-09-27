import type { PremissasMercado } from "../../shared/data/mercado";
import { addDays, diffDays, fromDay, toDay } from "../../shared/lib/dates";
import { cdiAnual, chavePremissas } from "../../shared/lib/taxas";
import type { ContratoDivida } from "../data/contratos";

/**
 * Motor de cálculo das captações (custo amortizado).
 *
 * Cada contrato é simulado dia a dia, da captação ao vencimento (base de 365 dias corridos, conforme Premissas):
 * juros sobre o principal atualizado, atualização monetária (IPCA/TLP), apropriação linear dos custos de
 * transação e pagamentos de principal e juros nas datas contratuais. Até a data-base valem as taxas históricas
 * importadas do SAP; depois dela, o último dado disponível (projeção com taxa constante).
 */

// ---------------------------------------------------------------------------
// Taxas
// ---------------------------------------------------------------------------

/** Taxa de juros a.a. do contrato no dia (sem a correção monetária) */
export function taxaJurosAnual(c: ContratoDivida, day: number, p: PremissasMercado): number {
  switch (c.indexador) {
    case "CDI":
      return (1 + cdiAnual(day, p)) * (1 + c.spread) - 1;
    case "IPCA":
      return c.spread;
    case "TJLP":
      return (1 + p.tjlp) * (1 + c.spread) * (1 + (c.spreadAgente ?? 0)) - 1;
    case "TLP":
      return (1 + p.tlpReal) * (1 + c.spread) - 1;
    case "Pré":
      return c.spread;
  }
}

/** Correção monetária a.a. do principal (IPCA para IPCA+ e TLP) */
export function correcaoAnual(c: ContratoDivida, p: PremissasMercado): number {
  return c.indexador === "IPCA" || c.indexador === "TLP" ? p.ipca12m : 0;
}

/** Custo total a.a. (juros + correção monetária) com as taxas vigentes na data */
export function taxaEfetivaAnual(c: ContratoDivida, data: string, p: PremissasMercado): number {
  return (1 + taxaJurosAnual(c, toDay(data), p)) * (1 + correcaoAnual(c, p)) - 1;
}

// ---------------------------------------------------------------------------
// Simulação
// ---------------------------------------------------------------------------

export interface EventoPagamento {
  data: string;
  principal: number;
  juros: number;
}

interface Simulacao {
  c: ContratoDivida;
  d0: number;
  n: number;
  pn: Float64Array; // principal nominal (fim do dia)
  pa: Float64Array; // principal atualizado
  jap: Float64Array; // juros a pagar
  ca: Float64Array; // custos de transação a apropriar
  jurosAc: Float64Array;
  amAc: Float64Array;
  custosAc: Float64Array;
  principalPagoAc: Float64Array;
  jurosPagosAc: Float64Array;
  capitalizadoAc: Float64Array;
  eventos: EventoPagamento[];
}

const simulacoes = new Map<string, Simulacao>();

function simular(c: ContratoDivida, p: PremissasMercado): Simulacao {
  const key = `${c.id}|${chavePremissas(p)}`;
  const hit = simulacoes.get(key);
  if (hit) return hit;

  const d0 = toDay(c.dataCaptacao);
  const n = toDay(c.vencimento) - d0;
  const mk = () => new Float64Array(n + 1);
  const sim: Simulacao = {
    c,
    d0,
    n,
    pn: mk(),
    pa: mk(),
    jap: mk(),
    ca: mk(),
    jurosAc: mk(),
    amAc: mk(),
    custosAc: mk(),
    principalPagoAc: mk(),
    jurosPagosAc: mk(),
    capitalizadoAc: mk(),
    eventos: [],
  };

  const amort = new Map<string, number>();
  for (const a of c.amortizacoes) amort.set(a.data, (amort.get(a.data) ?? 0) + a.pct);
  const datasJuros = new Set(c.datasJuros);
  const corr = correcaoAnual(c, p);
  const fCorr = Math.pow(1 + corr, 1 / 365) - 1;
  const custoDia = c.custosTransacao / n;
  const capAte = c.capitalizacaoCPC20 ? toDay(c.capitalizacaoCPC20.ate) : -Infinity;

  let pn = c.valorCaptado;
  let pa = c.valorCaptado;
  let jap = 0;
  let ca = c.custosTransacao;
  let jurosAc = 0;
  let amAc = 0;
  let custosAc = 0;
  let principalPagoAc = 0;
  let jurosPagosAc = 0;
  let capitalizadoAc = 0;

  const gravar = (i: number) => {
    sim.pn[i] = pn;
    sim.pa[i] = pa;
    sim.jap[i] = jap;
    sim.ca[i] = ca;
    sim.jurosAc[i] = jurosAc;
    sim.amAc[i] = amAc;
    sim.custosAc[i] = custosAc;
    sim.principalPagoAc[i] = principalPagoAc;
    sim.jurosPagosAc[i] = jurosPagosAc;
    sim.capitalizadoAc[i] = capitalizadoAc;
  };
  gravar(0);

  for (let i = 1; i <= n; i++) {
    const dia = d0 + i;
    const juros = pa * (Math.pow(1 + taxaJurosAnual(c, dia - 1, p), 1 / 365) - 1);
    const am = pa * fCorr;
    pa += am;
    jap += juros;
    ca -= custoDia;
    jurosAc += juros;
    amAc += am;
    custosAc += custoDia;
    if (dia <= capAte) capitalizadoAc += juros + am + custoDia;

    const iso = fromDay(dia);
    let principalPago = 0;
    let jurosPagos = 0;
    const pct = amort.get(iso) ?? 0;
    if (pct > 0 || i === n) {
      const nominal = i === n ? pn : Math.min(pn, pct * c.valorCaptado);
      const atualizado = pn > 0 ? (i === n ? pa : nominal * (pa / pn)) : 0;
      pn -= nominal;
      pa -= atualizado;
      principalPago = atualizado;
    }
    if (datasJuros.has(iso) || i === n) {
      jurosPagos = jap;
      jap = 0;
    }
    if (i === n) {
      pn = 0;
      pa = 0;
      ca = 0;
    }
    principalPagoAc += principalPago;
    jurosPagosAc += jurosPagos;
    if (principalPago > 0 || jurosPagos > 0) sim.eventos.push({ data: iso, principal: principalPago, juros: jurosPagos });
    gravar(i);
  }
  simulacoes.set(key, sim);
  return sim;
}

/** Índice do dia na simulação (−1 = antes da captação) */
function indice(sim: Simulacao, data: string): number {
  const i = toDay(data) - sim.d0;
  if (i < 0) return -1;
  return Math.min(i, sim.n);
}

function ler(arr: Float64Array, i: number): number {
  return i < 0 ? 0 : arr[i];
}

// ---------------------------------------------------------------------------
// Posição (C00 / C02)
// ---------------------------------------------------------------------------

export interface PosicaoDivida {
  c: ContratoDivida;
  principalNominal: number;
  principalAtualizado: number;
  atualizacaoMonetaria: number; // principal atualizado − principal nominal remanescente
  jurosAPagar: number;
  custosAApropriar: number;
  saldoContabil: number; // custo amortizado
  /** principal atualizado que vence em até 12 meses (ou todo o principal, se reclassificado) */
  principalCirculante: number;
  /** custos de transação a apropriar nos próximos 12 meses (redutora do circulante) */
  custosCirculante: number;
  circulante: number;
  naoCirculante: number;
  reclassificado: boolean;
  taxaEfetivaAA: number;
  cet: number;
  prazoMedioAnos: number;
  proximoPagamento: EventoPagamento | null;
  diasAteVencimento: number;
}

export function ativoEm(c: ContratoDivida, data: string): boolean {
  return c.dataCaptacao <= data && data < c.vencimento;
}

export function saldoContabil(c: ContratoDivida, data: string, p: PremissasMercado): number {
  const sim = simular(c, p);
  const i = indice(sim, data);
  if (i < 0) return 0;
  return sim.pa[i] + sim.jap[i] - sim.ca[i];
}

export function eventosFuturos(c: ContratoDivida, data: string, p: PremissasMercado): EventoPagamento[] {
  return simular(c, p).eventos.filter((e) => e.data > data);
}

const cets = new Map<string, number>();

/** Custo efetivo total a.a. (TIR dos fluxos: captação líquida de custos × pagamentos projetados) */
export function custoEfetivoTotal(c: ContratoDivida, p: PremissasMercado): number {
  const key = `${c.id}|${chavePremissas(p)}`;
  const hit = cets.get(key);
  if (hit !== undefined) return hit;
  const sim = simular(c, p);
  const fluxos = [{ t: 0, v: c.valorCaptado - c.custosTransacao }, ...sim.eventos.map((e) => ({ t: diffDays(c.dataCaptacao, e.data) / 365, v: -(e.principal + e.juros) }))];
  const vpl = (i: number) => fluxos.reduce((s, f) => s + f.v / Math.pow(1 + i, f.t), 0);
  let lo = -0.5;
  let hi = 2;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    // VPL cresce com a taxa: acima da raiz é positivo
    if (vpl(mid) > 0) hi = mid;
    else lo = mid;
  }
  const r = (lo + hi) / 2;
  cets.set(key, r);
  return r;
}

export function calcularPosicaoDivida(c: ContratoDivida, data: string, p: PremissasMercado, reclassificar = false): PosicaoDivida {
  const sim = simular(c, p);
  const i = indice(sim, data);
  const pn = ler(sim.pn, i);
  const pa = ler(sim.pa, i);
  const jap = ler(sim.jap, i);
  const ca = ler(sim.ca, i);
  const saldo = pa + jap - ca;
  const fator = pn > 0 ? pa / pn : 1;
  const limite = addDays(data, 365);
  const principalCP = c.amortizacoes.filter((a) => a.data > data && a.data <= limite).reduce((s, a) => s + a.pct * c.valorCaptado * fator, 0);
  const diasRestantes = Math.max(0, sim.n - i);
  const custosCP = (c.custosTransacao / sim.n) * Math.min(365, diasRestantes);
  let principalCirculante = Math.min(pa, principalCP);
  let custosCirculante = Math.min(ca, custosCP);
  if (reclassificar) {
    principalCirculante = pa;
    custosCirculante = ca;
  }
  // Sem principal no curto prazo, a redutora circulante fica limitada aos juros a pagar (o excedente segue no não
  // circulante), mantendo circulante = principal CP + juros − custos CP também nas contas do FI-GL (C05).
  custosCirculante = Math.min(custosCirculante, principalCirculante + jap);
  const circulante = Math.min(saldo, principalCirculante + jap - custosCirculante);
  const futuras = c.amortizacoes.filter((a) => a.data > data);
  const somaPct = futuras.reduce((s, a) => s + a.pct, 0);
  const prazoMedioAnos = somaPct > 0 ? futuras.reduce((s, a) => s + a.pct * (diffDays(data, a.data) / 365), 0) / somaPct : 0;
  const proximo = sim.eventos.find((e) => e.data > data) ?? null;
  return {
    c,
    principalNominal: pn,
    principalAtualizado: pa,
    atualizacaoMonetaria: pa - pn,
    jurosAPagar: jap,
    custosAApropriar: ca,
    saldoContabil: saldo,
    principalCirculante,
    custosCirculante,
    circulante,
    naoCirculante: saldo - circulante,
    reclassificado: reclassificar,
    taxaEfetivaAA: taxaEfetivaAnual(c, data, p),
    cet: custoEfetivoTotal(c, p),
    prazoMedioAnos,
    proximoPagamento: proximo,
    diasAteVencimento: diffDays(data, c.vencimento),
  };
}

/** Posições dos contratos ativos na data; `reclassificados` = ids com LP reclassificado para o circulante (CPC 26.74) */
export function posicoesDivida(
  contratos: ContratoDivida[],
  data: string,
  p: PremissasMercado,
  reclassificados: Set<string> = new Set(),
): PosicaoDivida[] {
  return contratos.filter((c) => ativoEm(c, data)).map((c) => calcularPosicaoDivida(c, data, p, reclassificados.has(c.id)));
}

export function totalDivida(pos: PosicaoDivida[]): number {
  return pos.reduce((s, x) => s + x.saldoContabil, 0);
}

/** Custo médio ponderado pelo saldo contábil (a.a.) – alimenta Premissas e R06 */
export function custoMedioPonderado(pos: PosicaoDivida[]): number {
  const total = totalDivida(pos);
  return total > 0 ? pos.reduce((s, x) => s + x.taxaEfetivaAA * x.saldoContabil, 0) / total : 0;
}

export function prazoMedioCarteira(pos: PosicaoDivida[]): number {
  const total = pos.reduce((s, x) => s + x.principalAtualizado, 0);
  return total > 0 ? pos.reduce((s, x) => s + x.prazoMedioAnos * x.principalAtualizado, 0) / total : 0;
}

// ---------------------------------------------------------------------------
// Movimentação (C01) e encargos (C03)
// ---------------------------------------------------------------------------

export interface MovContrato {
  c: ContratoDivida;
  saldoInicial: number;
  captacoes: number;
  custosTransacao: number; // negativo
  juros: number;
  atualizacaoMonetaria: number;
  apropriacaoCustos: number;
  pagamentoPrincipal: number; // negativo
  pagamentoJuros: number; // negativo
  saldoFinal: number;
  capitalizados: number; // parcela dos encargos capitalizada (CPC 20)
}

export function movimentacaoContrato(c: ContratoDivida, inicio: string, fim: string, p: PremissasMercado): MovContrato {
  const sim = simular(c, p);
  const a = indice(sim, inicio);
  const b = indice(sim, fim);
  const delta = (arr: Float64Array) => ler(arr, b) - ler(arr, a);
  const nova = c.dataCaptacao > inicio && c.dataCaptacao <= fim;
  return {
    c,
    saldoInicial: saldoContabil(c, inicio, p),
    captacoes: nova ? c.valorCaptado : 0,
    custosTransacao: nova ? -c.custosTransacao : 0,
    juros: delta(sim.jurosAc),
    atualizacaoMonetaria: delta(sim.amAc),
    apropriacaoCustos: delta(sim.custosAc),
    pagamentoPrincipal: -delta(sim.principalPagoAc),
    pagamentoJuros: -delta(sim.jurosPagosAc),
    saldoFinal: saldoContabil(c, fim, p),
    capitalizados: delta(sim.capitalizadoAc),
  };
}

export type CamposMov = Exclude<keyof MovContrato, "c">;

export const CAMPOS_MOV: CamposMov[] = [
  "saldoInicial",
  "captacoes",
  "custosTransacao",
  "juros",
  "atualizacaoMonetaria",
  "apropriacaoCustos",
  "pagamentoPrincipal",
  "pagamentoJuros",
  "saldoFinal",
  "capitalizados",
];

export function movimentacaoDivida(contratos: ContratoDivida[], inicio: string, fim: string, p: PremissasMercado) {
  const linhas = contratos
    .filter((c) => c.dataCaptacao <= fim && c.vencimento > inicio)
    .map((c) => movimentacaoContrato(c, inicio, fim, p));
  const total = Object.fromEntries(CAMPOS_MOV.map((k) => [k, linhas.reduce((s, l) => s + l[k], 0)])) as Record<CamposMov, number>;
  return { linhas, total };
}

/** Diferença de fechamento do roll-forward (deve ser ~0) */
export function diferencaRollforward(m: Record<CamposMov, number>): number {
  return (
    m.saldoInicial +
    m.captacoes +
    m.custosTransacao +
    m.juros +
    m.atualizacaoMonetaria +
    m.apropriacaoCustos +
    m.pagamentoPrincipal +
    m.pagamentoJuros -
    m.saldoFinal
  );
}

export interface EncargosContrato {
  c: ContratoDivida;
  saldoMedio: number;
  juros: number;
  atualizacaoMonetaria: number;
  apropriacaoCustos: number;
  total: number;
  capitalizados: number;
  despesaFinanceira: number;
  taxaPeriodo: number; // encargos / saldo médio
  taxaAnualizada: number;
}

export function encargosDivida(contratos: ContratoDivida[], inicio: string, fim: string, p: PremissasMercado): EncargosContrato[] {
  const dias = Math.max(1, diffDays(inicio, fim));
  return movimentacaoDivida(contratos, inicio, fim, p).linhas.map((m) => {
    const total = m.juros + m.atualizacaoMonetaria + m.apropriacaoCustos;
    const saldoMedio = (m.saldoInicial + m.saldoFinal + (m.captacoes ? m.captacoes + m.custosTransacao : 0)) / 2;
    const taxaPeriodo = saldoMedio > 0 ? total / saldoMedio : 0;
    return {
      c: m.c,
      saldoMedio,
      juros: m.juros,
      atualizacaoMonetaria: m.atualizacaoMonetaria,
      apropriacaoCustos: m.apropriacaoCustos,
      total,
      capitalizados: m.capitalizados,
      despesaFinanceira: total - m.capitalizados,
      taxaPeriodo,
      taxaAnualizada: Math.pow(1 + taxaPeriodo, 365 / dias) - 1,
    };
  });
}

/** Serviço da dívida (principal + juros pagos) no período – base do ICSD */
export function servicoDivida(contratos: ContratoDivida[], inicio: string, fim: string, p: PremissasMercado): number {
  const t = movimentacaoDivida(contratos, inicio, fim, p).total;
  return -(t.pagamentoPrincipal + t.pagamentoJuros);
}

// ---------------------------------------------------------------------------
// Cronograma (C02)
// ---------------------------------------------------------------------------

export interface LinhaCronograma {
  c: ContratoDivida;
  eventos: EventoPagamento[];
}

export function cronograma(contratos: ContratoDivida[], data: string, p: PremissasMercado): LinhaCronograma[] {
  return contratos.filter((c) => ativoEm(c, data)).map((c) => ({ c, eventos: eventosFuturos(c, data, p) }));
}

/** Principal remanescente pelo valor contábil (fator de correção da data-base) agrupado por ano de vencimento */
export function principalPorAno(c: ContratoDivida, data: string, p: PremissasMercado): Map<number, number> {
  const pos = calcularPosicaoDivida(c, data, p);
  const fator = pos.principalNominal > 0 ? pos.principalAtualizado / pos.principalNominal : 1;
  const out = new Map<number, number>();
  for (const a of c.amortizacoes) {
    if (a.data <= data) continue;
    const ano = Number(a.data.slice(0, 4));
    out.set(ano, (out.get(ano) ?? 0) + a.pct * c.valorCaptado * fator);
  }
  return out;
}

/**
 * Perfil de amortização do principal pelo valor contábil da data-base: parcela circulante (próximos 12 meses,
 * ou todo o principal se reclassificado) e não circulante por ano de vencimento.
 */
export function perfilAmortizacao(pos: PosicaoDivida, data: string): { circulante: number; porAno: Map<number, number> } {
  const porAno = new Map<number, number>();
  if (pos.reclassificado) return { circulante: pos.principalAtualizado, porAno };
  const fator = pos.principalNominal > 0 ? pos.principalAtualizado / pos.principalNominal : 1;
  const limite = addDays(data, 365);
  for (const a of pos.c.amortizacoes) {
    if (a.data <= limite) continue;
    const ano = Number(a.data.slice(0, 4));
    porAno.set(ano, (porAno.get(ano) ?? 0) + a.pct * pos.c.valorCaptado * fator);
  }
  return { circulante: pos.principalCirculante, porAno };
}
