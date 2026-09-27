import { CONTRATOS } from "../../captacoes/data/contratos";
import type { CovenantDivida } from "../../captacoes/data/covenants";
import {
  indicadoresEm,
  reclassificadosEm,
  trimestresAte as trimestresCorporativos,
  type ApuracaoCovenant,
  type IndicadoresCorporativos,
} from "../../captacoes/lib/covenants";
import { custoMedioPonderado, posicoesDivida, totalDivida } from "../../captacoes/lib/divida";
import type { ValueState } from "../../shared/components/fiori/ObjectStatus";
import { dadosCorporativosAte } from "../../shared/data/corporativo";
import { premissasNaDataBase, type PremissasMercado as Premissas } from "../../shared/data/mercado";
import { fmtQuarter } from "../../shared/lib/dates";
import { fmtDec, fmtPct, fmtX } from "../../shared/lib/format";
import type { Semaforo } from "../../shared/lib/semaforo";
import { LIMITE_POR_RATING, OPERACOES, REGRAS_POLITICA, type Rating } from "../data/carteira";
import { posicoesEm, taxaAnualEquivalente, type Posicao } from "./finance";

export type { Semaforo } from "../../shared/lib/semaforo";
export { SEMAFORO_TEXTO } from "../../shared/lib/semaforo";

// ---------------------------------------------------------------------------
// R07 – Concentração
// ---------------------------------------------------------------------------

export interface GrupoExposicao {
  grupo: string;
  rating: Rating;
  contrapartes: string[];
  operacoes: number;
  valor: number;
  share: number;
  limite: number;
  utilizacao: number;
  status: Semaforo;
}

export function semaforoUtilizacao(u: number): Semaforo {
  if (u > 1) return "excedido";
  if (u >= 0.8) return "atencao";
  return "ok";
}

export function totalCarteira(pos: Posicao[]): number {
  return pos.reduce((s, p) => s + p.valorBruto, 0);
}

export function concentracaoPorGrupo(pos: Posicao[]): GrupoExposicao[] {
  const total = totalCarteira(pos);
  const map = new Map<string, GrupoExposicao>();
  for (const p of pos) {
    const g = map.get(p.op.grupo) ?? {
      grupo: p.op.grupo,
      rating: p.op.rating,
      contrapartes: [],
      operacoes: 0,
      valor: 0,
      share: 0,
      limite: LIMITE_POR_RATING[p.op.rating],
      utilizacao: 0,
      status: "ok" as Semaforo,
    };
    g.operacoes++;
    g.valor += p.valorBruto;
    if (!g.contrapartes.includes(p.op.contraparte)) g.contrapartes.push(p.op.contraparte);
    map.set(p.op.grupo, g);
  }
  return [...map.values()]
    .map((g) => {
      const share = total > 0 ? g.valor / total : 0;
      const utilizacao = g.limite > 0 ? share / g.limite : 0;
      return { ...g, share, utilizacao, status: semaforoUtilizacao(utilizacao) };
    })
    .sort((a, b) => b.valor - a.valor);
}

export interface Fatia {
  chave: string;
  valor: number;
  share: number;
  qtd: number;
}

export function distribuicao(pos: Posicao[], chave: (p: Posicao) => string, ordem?: string[]): Fatia[] {
  const total = totalCarteira(pos);
  const map = new Map<string, Fatia>();
  for (const p of pos) {
    const k = chave(p);
    const f = map.get(k) ?? { chave: k, valor: 0, share: 0, qtd: 0 };
    f.valor += p.valorBruto;
    f.qtd++;
    map.set(k, f);
  }
  const out = [...map.values()].map((f) => ({ ...f, share: total > 0 ? f.valor / total : 0 }));
  if (ordem) return ordem.map((k) => out.find((f) => f.chave === k) ?? { chave: k, valor: 0, share: 0, qtd: 0 });
  return out.sort((a, b) => b.valor - a.valor);
}

/** Índice Herfindahl-Hirschman (0–10.000) */
export function hhi(shares: number[]): number {
  return shares.reduce((s, x) => s + Math.pow(x * 100, 2), 0);
}

export function classificarHHI(v: number): { rotulo: string; status: Semaforo } {
  if (v < 1500) return { rotulo: "Baixa concentração", status: "ok" };
  if (v <= 2500) return { rotulo: "Concentração moderada", status: "atencao" };
  return { rotulo: "Alta concentração", status: "excedido" };
}

export interface ResultadoRegra {
  id: string;
  regra: string;
  tipo: "max" | "min";
  limite: number;
  valor: number;
  share: number;
  status: Semaforo;
}

export function avaliarPolitica(pos: Posicao[]): ResultadoRegra[] {
  const total = totalCarteira(pos);
  const soma = (f: (p: Posicao) => boolean) => pos.filter(f).reduce((s, p) => s + p.valorBruto, 0);
  const valores: Record<string, number> = {
    credito: soma((p) => ["Debênture", "CRI", "CRA"].includes(p.op.produto)),
    fundos: soma((p) => p.op.produto === "Fundo RF"),
    liquidez: soma((p) => p.liquidezImediata),
    longo: soma((p) => p.prazoRemanescente !== null && p.prazoRemanescente > 730),
    pre: soma((p) => p.op.indexador === "Pré"),
  };
  return REGRAS_POLITICA.map((r) => {
    const valor = valores[r.id] ?? 0;
    const share = total > 0 ? valor / total : 0;
    let status: Semaforo;
    if (r.tipo === "max") status = share > r.limite ? "excedido" : share >= r.limite * 0.8 ? "atencao" : "ok";
    else status = share < r.limite ? "excedido" : share <= r.limite * 1.2 ? "atencao" : "ok";
    return { ...r, valor, share, status };
  });
}

// ---------------------------------------------------------------------------
// R06 – Endividamento × Aplicações
// Dívida, encargos, custo médio e covenants vêm da carteira de captações (dívida) do mesmo ambiente SAP.
// ---------------------------------------------------------------------------

export { apurarCovenants, type ApuracaoCovenant } from "../../captacoes/lib/covenants";

/**
 * Rótulo do covenant contratual, no mesmo vocabulário da apuração de covenants da carteira de captações:
 * descumprido sem waiver na data-base = negativo (reclassifica pelo CPC 26.74); com waiver ou em atenção = crítico.
 */
export function rotuloCovenant(a: ApuracaoCovenant): { state: ValueState; texto: string } {
  if (!a.dataApuracao) return { state: "neutral", texto: "Sem apuração" };
  if (a.status === "excedido") return a.reclassifica ? { state: "negative", texto: "Descumprido" } : { state: "critical", texto: "Descumprido – waiver" };
  if (a.status === "atencao") return { state: "critical", texto: "Atenção" };
  return { state: "positive", texto: "Cumprido" };
}

/** Valor apurado: índice de capitalização em %, demais em múltiplos */
export function fmtValorCovenant(cov: CovenantDivida, v: number): string {
  return cov.formato === "pct" ? fmtPct(v, 1) : fmtX(v);
}

export function fmtLimiteCovenant(cov: CovenantDivida): string {
  return `${cov.tipo === "max" ? "≤" : "≥"} ${cov.formato === "pct" ? fmtPct(cov.limite, 0) : fmtX(cov.limite)}`;
}

export function fmtFolgaCovenant(cov: CovenantDivida, folga: number): string {
  const sinal = folga < 0 ? "−" : "";
  return cov.formato === "pct" ? `${sinal}${fmtDec(Math.abs(folga) * 100, 1)} p.p.` : `${sinal}${fmtX(Math.abs(folga))}`;
}

/** "4T25" para covenants trimestrais, "2025" para anuais */
export function rotuloApuracao(a: ApuracaoCovenant): string {
  if (!a.dataApuracao) return "—";
  return a.cov.periodicidade === "Anual" ? `exercício ${a.dataApuracao.slice(0, 4)}` : fmtQuarter(a.dataApuracao);
}

/** Limites da política financeira interna (não são covenants contratuais) */
export interface LimitePolitica {
  id: "liquidez" | "dlPl";
  indicador: string;
  formula: string;
  tipo: "max" | "min";
  limite: number;
  alerta: number;
  fonte: string;
}

export const LIMITES_POLITICA: LimitePolitica[] = [
  {
    id: "liquidez",
    indicador: "Liquidez de curto prazo",
    formula: "(Caixa + aplicações circulantes) ÷ dívida circulante",
    tipo: "min",
    limite: 1.0,
    alerta: 1.2,
    fonte: "Política financeira interna",
  },
  {
    id: "dlPl",
    indicador: "Dívida líquida / PL",
    formula: "Dívida líquida ÷ patrimônio líquido",
    tipo: "max",
    limite: 1.0,
    alerta: 0.8,
    fonte: "Política financeira interna",
  },
];

export interface IndicadoresTrimestre extends IndicadoresCorporativos {
  dividaCP: number;
  caixaTotal: number;
  cobertura: number;
  liquidezCP: number;
}

export function indicadoresTrimestre(data: string): IndicadoresTrimestre {
  const ind = indicadoresEm(data);
  const p = premissasNaDataBase(data);
  const dividaCP = posicoesDivida(CONTRATOS, data, p, reclassificadosEm(data)).reduce((s, x) => s + x.circulante, 0);
  return {
    ...ind,
    dividaCP,
    caixaTotal: ind.caixa + ind.aplicacoes,
    cobertura: ind.ebitdaDespFin,
    liquidezCP: dividaCP > 0 ? (ind.caixa + ind.aplicacoesCirculantes) / dividaCP : 0,
  };
}

/** Fins de trimestre com dados até a data-base (a partir do 1T25) */
export function trimestresAte(dataBase: string): string[] {
  return trimestresCorporativos(dataBase).filter((d) => d >= "2025-03-31");
}

function valorLimite(l: LimitePolitica, i: IndicadoresTrimestre): number {
  return l.id === "liquidez" ? i.liquidezCP : i.dlPl;
}

export function statusLimite(l: LimitePolitica, valor: number): Semaforo {
  if (l.tipo === "max") return valor > l.limite ? "excedido" : valor >= l.alerta ? "atencao" : "ok";
  return valor < l.limite ? "excedido" : valor <= l.alerta ? "atencao" : "ok";
}

/** Limites da política financeira interna apurados no fim de trimestre `i.data` */
export function avaliarLimitesPolitica(i: IndicadoresTrimestre) {
  return LIMITES_POLITICA.map((l) => {
    const valor = valorLimite(l, i);
    return { ...l, valor, folga: l.tipo === "max" ? l.limite - valor : valor - l.limite, status: statusLimite(l, valor) };
  });
}

/** Endividamento na data-base: dívida pelo custo amortizado (com a reclassificação CPC 26.74, se houver) e aplicações pelo valor contábil */
export interface EndividamentoNaData {
  data: string;
  dividaBruta: number;
  dividaCirculante: number;
  dividaNaoCirculante: number;
  /** não circulante reclassificado para o circulante por descumprimento de covenant sem waiver (CPC 26.74) */
  reclassificado: number;
  idsReclassificados: string[];
  /** disponibilidades do último balancete trimestral até a data-base (dado corporativo) */
  caixa: number;
  dataCaixa: string | null;
  aplicacoesContabil: number;
  aplicacoesBruto: number;
  dividaLiquida: number;
}

export function endividamentoEm(p: Premissas): EndividamentoNaData {
  const data = p.dataBase;
  const reclass = reclassificadosEm(data);
  const pos = posicoesDivida(CONTRATOS, data, p, reclass);
  const contratual = reclass.size ? posicoesDivida(CONTRATOS, data, p) : pos;
  const circ = pos.reduce((s, x) => s + x.circulante, 0);
  const circContratual = contratual.reduce((s, x) => s + x.circulante, 0);
  const aplic = posicoesEm(OPERACOES, data, p);
  const corp = dadosCorporativosAte(data);
  const ultimo = corp[corp.length - 1] ?? null;
  const dividaBruta = totalDivida(pos);
  const caixa = ultimo?.caixa ?? 0;
  const aplicacoesContabil = aplic.reduce((s, x) => s + x.valorContabil, 0);
  return {
    data,
    dividaBruta,
    dividaCirculante: circ,
    dividaNaoCirculante: pos.reduce((s, x) => s + x.naoCirculante, 0),
    reclassificado: circ - circContratual,
    idsReclassificados: [...reclass].sort(),
    caixa,
    dataCaixa: ultimo?.data ?? null,
    aplicacoesContabil,
    aplicacoesBruto: aplic.reduce((s, x) => s + x.valorBruto, 0),
    dividaLiquida: dividaBruta - caixa - aplicacoesContabil,
  };
}

/** Custo médio ponderado da dívida na data (carteira de captações – alimenta Premissas e R06) */
export function custoMedioDivida(p: Premissas): number {
  return custoMedioPonderado(posicoesDivida(CONTRATOS, p.dataBase, p));
}

export interface Carry {
  saldo: number;
  taxaBruta: number;
  aliquotaMediaIR: number;
  taxaLiquida: number;
  custoDivida: number;
  carryBruto: number; // p.p.
  custoCarregamento: number; // R$ a.a.
}

export function calcularCarry(pos: Posicao[], p: Premissas): Carry {
  const saldo = totalCarteira(pos);
  const peso = (fn: (x: Posicao) => number) => (saldo > 0 ? pos.reduce((s, x) => s + fn(x) * x.valorBruto, 0) / saldo : 0);
  const taxaBruta = peso((x) => taxaAnualEquivalente(x.op, p));
  const aliquotaMediaIR = peso((x) => x.aliqIR);
  const taxaLiquida = taxaBruta * (1 - aliquotaMediaIR);
  const custoDivida = custoMedioDivida(p);
  const carryBruto = taxaBruta - custoDivida;
  return {
    saldo,
    taxaBruta,
    aliquotaMediaIR,
    taxaLiquida,
    custoDivida,
    carryBruto,
    custoCarregamento: saldo * carryBruto,
  };
}
