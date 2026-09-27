import type { ValueState } from "../../shared/components/fiori/ObjectStatus";
import type { PremissasMercado as Premissas } from "../../shared/data/mercado";
import { isBusinessDay, toDay } from "../../shared/lib/dates";
import { cdiAnual, chavePremissas } from "../../shared/lib/taxas";
import type { Operacao } from "../data/carteira";
import { ESCOPOS_BENCHMARK, type Benchmark } from "../data/benchmark";
import type { Posicao, RentabOp } from "./finance";

/**
 * Benchmark de rentabilidade em % do CDI.
 *
 * O rendimento do benchmark é calculado dia a dia, com o mesmo fator diário das aplicações indexadas ao CDI
 * (motor de aplicações): em cada dia útil em que a operação está ativa, DI diário = (1 + CDI do dia)^(1/252) − 1 e
 * fator do dia = 1 + DI diário × % do CDI da regra vigente NAQUELE dia. Assim:
 *   rendimento do benchmark = capital base × (Π (1 + DI diário × pct do dia) − 1)
 *   % do CDI do benchmark   = rendimento do benchmark ÷ (capital base × CDI do período)
 * – exatamente comparável ao % do CDI bruto realizado (rendimento ÷ capital base ÷ CDI do período). Uma aplicação
 * contratada ao mesmo % do CDI do benchmark fica "em linha" (diferença zero), e uma mudança de vigência altera o
 * resultado apenas nos dias em que a nova regra vigora.
 */

/** Benchmark aplicável à operação: o cadastro mais específico vigente na data (produto > portfolio > empresa > carteira) */
export function benchmarkDaOperacao(op: Operacao, cadastro: Benchmark[], data: string): Benchmark | null {
  const prioridade = (b: Benchmark) => ESCOPOS_BENCHMARK.find((e) => e.value === b.escopo)?.prioridade ?? 0;
  const aplicaveis = cadastro.filter((b) => {
    if (b.vigenciaInicio > data) return false;
    switch (b.escopo) {
      case "carteira":
        return true;
      case "empresa":
        return b.valor === op.empresa;
      case "portfolio":
        return b.valor === op.portfolio;
      case "produto":
        return b.valor === op.produto;
    }
  });
  if (!aplicaveis.length) return null;
  return aplicaveis.sort((a, b) => prioridade(b) - prioridade(a) || b.vigenciaInicio.localeCompare(a.vigenciaInicio))[0];
}

/** Regra da carteira consolidada vigente na data (a de vigência mais recente até a data) */
export function regraCarteiraVigente(cadastro: Benchmark[], data: string): Benchmark | null {
  return (
    cadastro
      .filter((b) => b.escopo === "carteira" && b.vigenciaInicio <= data)
      .sort((a, b) => b.vigenciaInicio.localeCompare(a.vigenciaInicio))[0] ?? null
  );
}

/** Taxa anual equivalente a um % do CDI, capitalizada diariamente: (1 + ((1 + CDI)^(1/252) − 1) × pct)^252 − 1 */
export function taxaEquivalenteBenchmark(pctCDI: number, cdi: number): number {
  return Math.pow(1 + (Math.pow(1 + cdi, 1 / 252) - 1) * pctCDI, 252) - 1;
}

// ---------------------------------------------------------------------------
// Fator do benchmark com vigência diária
// ---------------------------------------------------------------------------

/** Trecho [inicio, fim) em que a mesma regra se aplica à operação */
export interface TrechoBenchmark {
  inicio: string;
  fim: string;
  regra: Benchmark | null;
  /** fração do CDI aplicada no trecho (1 = 100% do CDI quando não há regra) */
  pct: number;
}

/** Regras aplicadas à operação em [inicio, fim): a regra aplicável só muda nas datas de início de vigência do cadastro */
export function trechosBenchmark(op: Operacao, cadastro: Benchmark[], inicio: string, fim: string): TrechoBenchmark[] {
  if (fim <= inicio) {
    const regra = benchmarkDaOperacao(op, cadastro, inicio);
    return [{ inicio, fim: inicio, regra, pct: regra?.pctCDI ?? 1 }];
  }
  const cortes = [...new Set(cadastro.map((b) => b.vigenciaInicio).filter((d) => d > inicio && d < fim))].sort();
  const limites = [inicio, ...cortes, fim];
  const out: TrechoBenchmark[] = [];
  for (let i = 0; i < limites.length - 1; i++) {
    const regra = benchmarkDaOperacao(op, cadastro, limites[i]);
    const pct = regra?.pctCDI ?? 1;
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.regra?.id === regra?.id && ultimo.pct === pct) ultimo.fim = limites[i + 1];
    else out.push({ inicio: limites[i], fim: limites[i + 1], regra, pct });
  }
  return out;
}

export interface FatorBenchmark {
  /** Π (1 + DI diário × pct do dia) nos dias úteis de [inicio, fim) */
  fator: number;
  /** Π (1 + DI diário) – mesmo fator do CDI do período usado no realizado */
  fatorCDI: number;
  /** % do CDI cadastrado, média dos dias ponderada pelo DI diário (sem capitalização) */
  pctRegra: number;
  trechos: TrechoBenchmark[];
}

const cacheDI = new Map<string, Map<number, number>>();

/** DI diário = (1 + CDI do dia)^(1/252) − 1, com o CDI importado do SAP até a data-base e o último dado depois dela */
function diDiario(dia: number, p: Premissas): number {
  const chave = chavePremissas(p);
  let m = cacheDI.get(chave);
  if (!m) {
    m = new Map();
    cacheDI.set(chave, m);
  }
  let v = m.get(dia);
  if (v === undefined) {
    v = Math.pow(1 + cdiAnual(dia, p), 1 / 252) - 1;
    m.set(dia, v);
  }
  return v;
}

/** Cache por cadastro (o contexto troca a lista inteira a cada alteração) */
const cacheFator = new WeakMap<Benchmark[], Map<string, FatorBenchmark>>();

/** Fator do benchmark da operação em [inicio, fim), com a regra vigente em cada dia */
export function fatorBenchmark(op: Operacao, cadastro: Benchmark[], inicio: string, fim: string, p: Premissas): FatorBenchmark {
  let porCadastro = cacheFator.get(cadastro);
  if (!porCadastro) {
    porCadastro = new Map();
    cacheFator.set(cadastro, porCadastro);
  }
  const chave = `${op.transacao}|${op.empresa}|${op.portfolio}|${op.produto}|${inicio}|${fim}|${chavePremissas(p)}`;
  const hit = porCadastro.get(chave);
  if (hit) return hit;

  const trechos = trechosBenchmark(op, cadastro, inicio, fim);
  let fator = 1;
  let fatorCDI = 1;
  let somaDI = 0;
  let somaDIPct = 0;
  for (const t of trechos) {
    for (let d = toDay(t.inicio), e = toDay(t.fim); d < e; d++) {
      if (!isBusinessDay(d)) continue;
      const di = diDiario(d, p);
      fator *= 1 + di * t.pct;
      fatorCDI *= 1 + di;
      somaDI += di;
      somaDIPct += di * t.pct;
    }
  }
  const r: FatorBenchmark = { fator, fatorCDI, pctRegra: somaDI > 0 ? somaDIPct / somaDI : (trechos[0]?.pct ?? 1), trechos };
  porCadastro.set(chave, r);
  return r;
}

// ---------------------------------------------------------------------------
// Comparação realizado × benchmark
// ---------------------------------------------------------------------------

export type SituacaoBenchmark = "acima" | "em linha" | "abaixo";

/** Tolerância para "em linha": ±0,5 p.p. do CDI */
export const TOLERANCIA_BENCHMARK = 0.005;

/** Compara % do CDI realizado com o % do CDI do benchmark no mesmo período e base */
export function situacaoBenchmark(realizado: number, benchmark: number): SituacaoBenchmark {
  const dif = realizado - benchmark;
  if (dif > TOLERANCIA_BENCHMARK) return "acima";
  if (dif < -TOLERANCIA_BENCHMARK) return "abaixo";
  return "em linha";
}

export interface ComparacaoBenchmark {
  /** % do CDI do benchmark no período (rendimento do benchmark ÷ (base × CDI do período)) – comparável ao realizado */
  pct: number;
  /** % do CDI cadastrado (média das regras vigentes no período, sem capitalização) */
  pctRegra: number;
  /** % do CDI bruto realizado (rendimento ÷ (base × CDI do período)) */
  realizado: number;
  /** capital base × CDI do período (denominador comum dos dois percentuais) */
  peso: number;
  /** rendimento que o benchmark teria gerado sobre a mesma base, capitalizado dia a dia (R$) */
  rendBenchmark: number;
  /** rendimento realizado (R$) */
  rendimento: number;
  /** rendimento realizado − rendimento do benchmark (R$) */
  excesso: number;
  situacao: SituacaoBenchmark;
}

export interface ComparacaoOperacao extends ComparacaoBenchmark {
  /** regras aplicadas no período (mais de um trecho quando há mudança de vigência) */
  trechos: TrechoBenchmark[];
}

function comparar(base: number, rendimento: number, fb: FatorBenchmark): ComparacaoOperacao {
  const peso = base * (fb.fatorCDI - 1);
  const rendBenchmark = base * (fb.fator - 1);
  const pct = peso > 0 ? rendBenchmark / peso : fb.pctRegra;
  const realizado = peso > 0 ? rendimento / peso : 0;
  return {
    pct,
    pctRegra: fb.pctRegra,
    realizado,
    peso,
    rendBenchmark,
    rendimento,
    excesso: rendimento - rendBenchmark,
    situacao: situacaoBenchmark(realizado, pct),
    trechos: fb.trechos,
  };
}

/** Benchmark × realizado de uma operação no período do R03 (capital base no início do período ou na aplicação) */
export function compararOperacao(r: RentabOp, cadastro: Benchmark[], p: Premissas): ComparacaoOperacao {
  return comparar(r.base, r.rendimento, fatorBenchmark(r.op, cadastro, r.inicio, r.fim, p));
}

/** Benchmark × realizado desde a aplicação até a data-base (R01): base = principal aplicado */
export function compararPosicao(pos: Posicao, cadastro: Benchmark[], p: Premissas): ComparacaoOperacao {
  return comparar(pos.op.principal, pos.rendimento, fatorBenchmark(pos.op, cadastro, pos.op.dataAplicacao, p.dataBase, p));
}

/** Soma de comparações: percentuais ponderados pelo mesmo peso (Σ base × CDI do período) */
export function somarComparacoes(cs: ComparacaoBenchmark[]): ComparacaoBenchmark {
  let peso = 0;
  let rendBenchmark = 0;
  let rendimento = 0;
  let pesoRegra = 0;
  for (const c of cs) {
    peso += c.peso;
    rendBenchmark += c.rendBenchmark;
    rendimento += c.rendimento;
    pesoRegra += c.peso * c.pctRegra;
  }
  const pct = peso > 0 ? rendBenchmark / peso : 1;
  const realizado = peso > 0 ? rendimento / peso : 0;
  return {
    pct,
    pctRegra: peso > 0 ? pesoRegra / peso : 1,
    realizado,
    peso,
    rendBenchmark,
    rendimento,
    excesso: rendimento - rendBenchmark,
    situacao: situacaoBenchmark(realizado, pct),
  };
}

/** Benchmark da carteira no período: Σ rendimentos do benchmark ÷ Σ (base × CDI do período), comparável ao realizado */
export function compararCarteira(linhas: RentabOp[], cadastro: Benchmark[], p: Premissas): ComparacaoBenchmark {
  return somarComparacoes(linhas.map((r) => compararOperacao(r, cadastro, p)));
}

/** Classe de cor do excesso em R$ (valores abaixo de R$ 0,50 – ruído de arredondamento – ficam neutros) */
export function corExcesso(v: number): string {
  if (Math.abs(v) < 0.5) return "text-label";
  return v > 0 ? "text-positive" : "text-negative";
}

export const SITUACAO_TEXTO: Record<SituacaoBenchmark, string> = {
  acima: "Acima do benchmark",
  "em linha": "Em linha",
  abaixo: "Abaixo do benchmark",
};

export const SITUACAO_STATE: Record<SituacaoBenchmark, ValueState> = {
  acima: "positive",
  "em linha": "information",
  abaixo: "critical",
};
