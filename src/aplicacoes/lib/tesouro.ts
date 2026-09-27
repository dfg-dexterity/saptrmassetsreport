import { CDI_MENSAL, IPCA_12M_MENSAL, valorDoMes, type PremissasMercado as Premissas } from "../../shared/data/mercado";
import { addDays, addMonths, diffDays, fromDay, isBusinessDay, proximoDiaUtil, toDay } from "../../shared/lib/dates";
import { chavePremissas } from "../../shared/lib/taxas";
import { PARAMETROS_TESOURO as P, TAXAS_MERCADO, type TituloPublico } from "../data/tesouro";
import { aliquotaIOF, aliquotaIR } from "./finance";

/**
 * R08 – Precificação de títulos públicos federais (convenções ANBIMA / Tesouro Nacional):
 * - LTN:  PU = 1.000 / (1 + taxa)^(du/252)
 * - NTN-F: PU = Σ cupom / (1 + taxa)^(du_i/252) + 1.000 / (1 + taxa)^(du_n/252), cupom = 1.000 × (1,10^0,5 − 1)
 * - LFT:  PU = VNA × 1 / (1 + taxa)^(du/252) (taxa = ágio/deságio; VNA corrigido pela Selic diária)
 * - NTN-B Principal: PU = VNA × 1 / (1 + taxa)^(du/252)
 * - NTN-B: PU = VNA × [Σ (1,06^0,5 − 1) / (1 + taxa)^(du_i/252) + 1 / (1 + taxa)^(du_n/252)] (VNA corrigido pelo IPCA)
 * Curva = PU à taxa de compra; mercado = PU à taxa indicativa do mês (ANBIMA). Valor contábil: curva (custo
 * amortizado) ou mercado (valor justo). Datas de cupom e vencimento no dia útil seguinte.
 */

// ---------------------------------------------------------------------------
// VNA
// ---------------------------------------------------------------------------

const cacheVNA = new Map<string, number>();

/** Selic diária histórica (série mensal do CDI + 0,10 p.p. importada do SAP) */
function selicHistorica(day: number): number {
  return valorDoMes(CDI_MENSAL, fromDay(day).slice(0, 7)) + 0.001;
}

/** Fator Selic histórico em [a, b) (dias úteis) */
function fatorSelic(a: string, b: string): number {
  let f = 1;
  for (let d = toDay(a), e = toDay(b); d < e; d++) if (isBusinessDay(d)) f *= Math.pow(1 + selicHistorica(d), 1 / 252);
  return f;
}

/** Fator IPCA histórico em [a, b) (pro rata por dia corrido, IPCA 12 meses do mês como taxa anual) */
function fatorIPCA(a: string, b: string): number {
  let f = 1;
  for (let d = toDay(a), e = toDay(b); d < e; d++) f *= Math.pow(1 + valorDoMes(IPCA_12M_MENSAL, fromDay(d).slice(0, 7)), 1 / 365);
  return f;
}

/** VNA da LFT: histórico até a data-base (ancorado no VNA importado); depois, projetado com a Selic da data-base */
export function vnaLFT(iso: string, p: Premissas): number {
  const k = `lft|${iso}|${chavePremissas(p)}`;
  const hit = cacheVNA.get(k);
  if (hit !== undefined) return hit;
  let v: number;
  if (iso <= p.dataBase) v = P.vnaLFT / fatorSelic(iso, P.dataVNA);
  else {
    const base = P.vnaLFT / fatorSelic(p.dataBase, P.dataVNA);
    let f = 1;
    for (let d = toDay(p.dataBase), e = toDay(iso); d < e; d++) if (isBusinessDay(d)) f *= Math.pow(1 + p.selic, 1 / 252);
    v = base * f;
  }
  cacheVNA.set(k, v);
  return v;
}

/** VNA da NTN-B: histórico até a data-base (ancorado no VNA importado); depois, projetado com o IPCA 12 meses */
export function vnaNTNB(iso: string, p: Premissas): number {
  const k = `ntnb|${iso}|${chavePremissas(p)}`;
  const hit = cacheVNA.get(k);
  if (hit !== undefined) return hit;
  let v: number;
  if (iso <= p.dataBase) v = P.vnaNTNB / fatorIPCA(iso, P.dataVNA);
  else v = (P.vnaNTNB / fatorIPCA(p.dataBase, P.dataVNA)) * Math.pow(1 + p.ipca12m, diffDays(p.dataBase, iso) / 365);
  cacheVNA.set(k, v);
  return v;
}

// ---------------------------------------------------------------------------
// Fluxos e PU
// ---------------------------------------------------------------------------

export interface FluxoTitulo {
  data: string;
  /** LTN/NTN-F: R$ por título; LFT/NTN-B: fração do VNA */
  valor: number;
  tipo: "Cupom" | "Principal";
}

const CUPOM_NTNF = P.valorFace * (Math.pow(1 + P.cupomNTNF, 0.5) - 1);
const CUPOM_NTNB = Math.pow(1 + P.cupomNTNB, 0.5) - 1;

const cacheFluxos = new Map<string, FluxoTitulo[]>();

/** Todos os fluxos do título (datas no dia útil seguinte) */
export function fluxosTitulo(t: TituloPublico): FluxoTitulo[] {
  const hit = cacheFluxos.get(t.id);
  if (hit) return hit;
  const venc = proximoDiaUtil(t.vencimento);
  const out: FluxoTitulo[] = [];
  if (t.tipo === "NTN-F" || t.tipo === "NTN-B") {
    // cupons semestrais retroagindo a partir do vencimento
    const cupom = t.tipo === "NTN-F" ? CUPOM_NTNF : CUPOM_NTNB;
    const datas: string[] = [];
    for (let i = 0; ; i++) {
      const d = addMonths(t.vencimento, -6 * i);
      if (d <= addDays(t.dataCompra, -200)) break;
      datas.push(d);
    }
    for (const d of datas.reverse()) out.push({ data: proximoDiaUtil(d), valor: cupom, tipo: "Cupom" });
  }
  const principal = t.tipo === "LTN" || t.tipo === "NTN-F" ? P.valorFace : 1;
  out.push({ data: venc, valor: principal, tipo: "Principal" });
  cacheFluxos.set(t.id, out);
  return out;
}

function duEntre(a: string, b: string): number {
  let n = 0;
  for (let d = toDay(a), e = toDay(b); d < e; d++) if (isBusinessDay(d)) n++;
  return n;
}

const cacheDU = new Map<string, number>();
function du(a: string, b: string): number {
  const k = `${a}|${b}`;
  let v = cacheDU.get(k);
  if (v === undefined) {
    v = duEntre(a, b);
    cacheDU.set(k, v);
  }
  return v;
}

/** PU do título na data `iso` à taxa informada (fluxos posteriores à data) */
export function puTitulo(t: TituloPublico, iso: string, taxa: number, p: Premissas): number {
  const fluxos = fluxosTitulo(t).filter((f) => f.data > iso);
  if (!fluxos.length) return 0;
  const vp = fluxos.reduce((s, f) => s + f.valor / Math.pow(1 + taxa, du(iso, f.data) / 252), 0);
  if (t.tipo === "LFT") return vnaLFT(iso, p) * vp;
  if (t.tipo === "NTN-B Principal" || t.tipo === "NTN-B") return vnaNTNB(iso, p) * vp;
  return vp;
}

/** Duration de Macaulay (anos úteis) à taxa informada */
export function durationTitulo(t: TituloPublico, iso: string, taxa: number): number {
  const fluxos = fluxosTitulo(t).filter((f) => f.data > iso);
  let vp = 0;
  let pond = 0;
  for (const f of fluxos) {
    const anos = du(iso, f.data) / 252;
    const v = f.valor / Math.pow(1 + taxa, anos);
    vp += v;
    pond += v * anos;
  }
  return vp > 0 ? pond / vp : 0;
}

/** Taxa indicativa de mercado (ANBIMA) no mês da data; antes da compra, a taxa de compra; depois da data-base, o último dado */
export function taxaMercado(t: TituloPublico, iso: string, p: Premissas): number {
  const serie = TAXAS_MERCADO[t.id] ?? {};
  const mes = (iso > p.dataBase ? p.dataBase : iso).slice(0, 7);
  if (serie[mes] !== undefined) return serie[mes];
  const meses = Object.keys(serie).filter((m) => m <= mes).sort();
  return meses.length ? serie[meses[meses.length - 1]] : t.taxaCompra;
}

// ---------------------------------------------------------------------------
// Posição
// ---------------------------------------------------------------------------

export interface EventoTitulo {
  data: string;
  tipo: "Cupom" | "Vencimento";
  /** valor bruto recebido (R$) */
  bruto: number;
  /** base de cálculo do IR retido no evento */
  base: number;
  ir: number;
  liquido: number;
}

/**
 * Juros decorridos (cupom corrido) pagos na compra de NTN-F/NTN-B entre datas de cupom: fração do 1º cupom
 * proporcional aos dias corridos desde a data do cupom anterior. Não compõem o rendimento tributável do 1º cupom.
 */
export function jurosDecorridosCompra(t: TituloPublico, p: Premissas): number {
  if (t.tipo !== "NTN-F" && t.tipo !== "NTN-B") return 0;
  const primeiro = fluxosTitulo(t).find((f) => f.tipo === "Cupom" && f.data > t.dataCompra);
  if (!primeiro) return 0;
  // data de referência do cupom (antes do ajuste para dia útil) e a anterior, seis meses antes
  const ref = addMonths(t.vencimento, -6 * Math.round(diffDays(primeiro.data, t.vencimento) / 182.625));
  const anterior = addMonths(ref, -6);
  const fracao = Math.min(1, Math.max(0, diffDays(anterior, t.dataCompra) / Math.max(1, diffDays(anterior, ref))));
  const vna = t.tipo === "NTN-B" ? vnaNTNB(t.dataCompra, p) : 1;
  return t.quantidade * primeiro.valor * vna * fracao;
}

const cacheEventos = new Map<string, EventoTitulo[]>();

/** Pagamentos (cupons e resgate no vencimento) recebidos ou projetados, com IR regressivo na fonte */
export function eventosTitulo(t: TituloPublico, p: Premissas): EventoTitulo[] {
  const k = `${t.id}|${chavePremissas(p)}`;
  const hit = cacheEventos.get(k);
  if (hit) return hit;
  const valorCompra = t.quantidade * puTitulo(t, t.dataCompra, t.taxaCompra, p);
  const decorridos = jurosDecorridosCompra(t, p);
  const out: EventoTitulo[] = [];
  let cuponsAcumulados = 0;
  let tributado = 0;
  let primeiroCupom = true;
  for (const f of fluxosTitulo(t)) {
    if (f.data <= t.dataCompra) continue;
    const indexado = t.tipo === "LFT" || t.tipo === "NTN-B Principal" || t.tipo === "NTN-B";
    const vna = t.tipo === "LFT" ? vnaLFT(f.data, p) : indexado ? vnaNTNB(f.data, p) : 1;
    const bruto = t.quantidade * f.valor * vna;
    const dias = diffDays(t.dataCompra, f.data);
    // IR: cupom (o 1º sem os juros decorridos pagos na compra); no vencimento, o ganho total ainda não tributado
    let base: number;
    if (f.tipo === "Cupom") {
      base = Math.max(0, bruto - (primeiroCupom ? decorridos : 0));
      primeiroCupom = false;
      cuponsAcumulados += bruto;
    } else base = Math.max(0, bruto + cuponsAcumulados - valorCompra - tributado);
    tributado += base;
    const ir = base * aliquotaIR(dias, "Regressivo");
    out.push({ data: f.data, tipo: f.tipo === "Cupom" ? "Cupom" : "Vencimento", bruto, base, ir, liquido: bruto - ir });
  }
  cacheEventos.set(k, out);
  return out;
}

export interface PosicaoTitulo {
  t: TituloPublico;
  data: string;
  ativo: boolean;
  diasCorridos: number;
  prazoRemanescente: number;
  duUteis: number;
  vna: number | null;
  puCompra: number;
  valorCompra: number;
  taxaMercado: number;
  puCurva: number;
  puMercado: number;
  saldoCurva: number;
  saldoMercado: number;
  /** marcação a mercado: mercado − curva */
  mtm: number;
  cuponsRecebidos: number;
  irCupons: number;
  /** curva + cupons recebidos − valor de compra */
  rendimentoBruto: number;
  iof: number;
  /** IR total devido sobre o rendimento (retido nos cupons + provisão sobre o saldo) */
  ir: number;
  /** custódia + taxa do agente acumuladas desde a compra */
  taxas: number;
  rendimentoLiquido: number;
  valorContabil: number;
  /** duration de taxa (Macaulay, anos úteis); LFT = 0 – pós-fixada, reprecificada diariamente pela Selic */
  duration: number;
  /** LFT: duration do ágio/deságio (spread sobre a Selic); demais títulos = duration */
  durationSpread: number;
  proximoCupom: EventoTitulo | null;
}

export function posicaoTitulo(t: TituloPublico, iso: string, p: Premissas): PosicaoTitulo {
  const ativo = t.dataCompra <= iso && iso < proximoDiaUtil(t.vencimento);
  const puCompra = puTitulo(t, t.dataCompra, t.taxaCompra, p);
  const valorCompra = t.quantidade * puCompra;
  const tm = taxaMercado(t, iso, p);
  const puCurva = ativo ? puTitulo(t, iso, t.taxaCompra, p) : 0;
  const puMercado = ativo ? puTitulo(t, iso, tm, p) : 0;
  const saldoCurva = t.quantidade * puCurva;
  const saldoMercado = t.quantidade * puMercado;
  const eventos = eventosTitulo(t, p).filter((e) => e.data <= iso && e.data > t.dataCompra);
  const cupons = eventos.filter((e) => e.tipo === "Cupom");
  const cuponsRecebidos = cupons.reduce((s, e) => s + e.bruto, 0);
  const irCupons = cupons.reduce((s, e) => s + e.ir, 0);
  const baseCupons = cupons.reduce((s, e) => s + e.base, 0);
  const diasCorridos = Math.max(0, diffDays(t.dataCompra, iso));
  const rendimentoBruto = ativo ? saldoCurva + cuponsRecebidos - valorCompra : 0;
  const iof = rendimentoBruto > 0 ? rendimentoBruto * aliquotaIOF(diasCorridos) : 0;
  // provisão sobre o rendimento ainda não tributado na fonte (cupons já recebidos saem da base)
  const irProvisao = Math.max(0, rendimentoBruto - iof - baseCupons) * aliquotaIR(diasCorridos, "Regressivo");
  const ir = ativo ? irCupons + irProvisao : 0;
  const taxas = ativo ? ((valorCompra + saldoCurva) / 2) * (P.custodiaB3 + P.taxaAgente) * (diasCorridos / 365) : 0;
  const indexado = t.tipo === "LFT" ? vnaLFT(iso, p) : t.tipo === "NTN-B" || t.tipo === "NTN-B Principal" ? vnaNTNB(iso, p) : null;
  const proximo = eventosTitulo(t, p).find((e) => e.data > iso) ?? null;
  return {
    t,
    data: iso,
    ativo,
    diasCorridos,
    prazoRemanescente: diffDays(iso, proximoDiaUtil(t.vencimento)),
    duUteis: ativo ? du(iso, proximoDiaUtil(t.vencimento)) : 0,
    vna: indexado,
    puCompra,
    valorCompra,
    taxaMercado: tm,
    puCurva,
    puMercado,
    saldoCurva,
    saldoMercado,
    mtm: saldoMercado - saldoCurva,
    cuponsRecebidos,
    irCupons,
    rendimentoBruto,
    iof,
    ir,
    taxas,
    rendimentoLiquido: rendimentoBruto - iof - ir - taxas,
    valorContabil: t.cpc48 === "Custo Amortizado" ? saldoCurva : saldoMercado,
    duration: ativo && t.tipo !== "LFT" ? durationTitulo(t, iso, tm) : 0,
    durationSpread: ativo ? durationTitulo(t, iso, tm) : 0,
    proximoCupom: proximo,
  };
}
