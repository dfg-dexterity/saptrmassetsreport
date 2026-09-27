import { CONTRATOS } from "../../captacoes/data/contratos";
import { indicadoresEm, reclassificadosEm, trimestresAte as trimestresCorporativos, type IndicadoresCorporativos } from "../../captacoes/lib/covenants";
import { custoMedioPonderado, posicoesDivida } from "../../captacoes/lib/divida";
import { premissasNaDataBase, type PremissasMercado as Premissas } from "../../shared/data/mercado";
import type { Semaforo } from "../../shared/lib/semaforo";
import { LIMITE_POR_RATING, REGRAS_POLITICA, type Rating } from "../data/carteira";
import { taxaAnualEquivalente, type Posicao } from "./finance";

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
// Dívida, encargos e custo médio vêm da carteira de captações do mesmo ambiente SAP (C00/C03).
// ---------------------------------------------------------------------------

export interface Covenant {
  id: "dlEbitda" | "cobertura" | "liquidez" | "dlPl";
  indicador: string;
  tipo: "max" | "min";
  limite: number;
  alerta: number;
  fonte: string;
}

export const COVENANTS: Covenant[] = [
  { id: "dlEbitda", indicador: "Dívida líquida / EBITDA", tipo: "max", limite: 3.0, alerta: 2.5, fonte: "Escrituras das debêntures e CCB" },
  { id: "cobertura", indicador: "EBITDA / Encargos da dívida", tipo: "min", limite: 2.0, alerta: 2.5, fonte: "Debênture incentivada e CRA" },
  { id: "liquidez", indicador: "Liquidez de curto prazo", tipo: "min", limite: 1.0, alerta: 1.2, fonte: "Política financeira interna" },
  { id: "dlPl", indicador: "Dívida líquida / PL", tipo: "max", limite: 1.0, alerta: 0.8, fonte: "Política financeira interna" },
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

export function valorCovenant(c: Covenant, i: IndicadoresTrimestre): number {
  switch (c.id) {
    case "dlEbitda":
      return i.dlEbitda;
    case "cobertura":
      return i.cobertura;
    case "liquidez":
      return i.liquidezCP;
    case "dlPl":
      return i.dlPl;
  }
}

export function statusCovenant(c: Covenant, valor: number): Semaforo {
  if (c.tipo === "max") return valor > c.limite ? "excedido" : valor >= c.alerta ? "atencao" : "ok";
  return valor < c.limite ? "excedido" : valor <= c.alerta ? "atencao" : "ok";
}

export function avaliarCovenants(i: IndicadoresTrimestre) {
  return COVENANTS.map((c) => {
    const valor = valorCovenant(c, i);
    return { ...c, valor, status: statusCovenant(c, valor) };
  });
}

/** Custo médio ponderado da dívida na data (C03 – alimenta Premissas e R06) */
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
