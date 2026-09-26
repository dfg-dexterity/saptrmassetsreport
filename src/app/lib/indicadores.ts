import { LIMITE_POR_RATING, REGRAS_POLITICA, type Operacao, type Rating } from "../data/carteira";
import { COVENANTS, TRIMESTRES, type Covenant, type Trimestre } from "../data/endividamento";
import type { Premissas } from "../data/premissas";
import { posicoesEm, taxaAnualEquivalente, type Posicao } from "./finance";

export type Semaforo = "ok" | "atencao" | "excedido";

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
// ---------------------------------------------------------------------------

export interface IndicadoresTrimestre extends Trimestre {
  aplicacoes: number;
  aplicacoesCirculantes: number;
  caixaTotal: number;
  dividaLiquida: number;
  dlEbitda: number;
  cobertura: number;
  liquidezCP: number;
  dlPl: number;
}

export function indicadoresTrimestre(t: Trimestre, ops: Operacao[], p: Premissas): IndicadoresTrimestre {
  const pos = posicoesEm(ops, t.data, p);
  const aplicacoes = totalCarteira(pos);
  const aplicacoesCirculantes = pos.filter((x) => x.circulante).reduce((s, x) => s + x.valorBruto, 0);
  const caixaTotal = t.caixa + aplicacoes;
  const dividaLiquida = t.dividaBruta - caixaTotal;
  return {
    ...t,
    aplicacoes,
    aplicacoesCirculantes,
    caixaTotal,
    dividaLiquida,
    dlEbitda: dividaLiquida / t.ebitdaLTM,
    cobertura: t.ebitdaLTM / t.jurosLTM,
    liquidezCP: (t.caixa + aplicacoesCirculantes) / t.dividaCP,
    dlPl: dividaLiquida / t.patrimonioLiquido,
  };
}

export function trimestresAte(dataBase: string): Trimestre[] {
  return TRIMESTRES.filter((t) => t.data <= dataBase);
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
  const carryBruto = taxaBruta - p.custoDivida;
  return {
    saldo,
    taxaBruta,
    aliquotaMediaIR,
    taxaLiquida,
    custoDivida: p.custoDivida,
    carryBruto,
    custoCarregamento: saldo * carryBruto,
  };
}

export const SEMAFORO_TEXTO: Record<Semaforo, string> = {
  ok: "Enquadrado",
  atencao: "Atenção",
  excedido: "Desenquadrado",
};
