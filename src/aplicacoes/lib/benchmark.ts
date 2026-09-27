import type { ValueState } from "../../shared/components/fiori/ObjectStatus";
import type { Operacao } from "../data/carteira";
import type { RentabOp } from "./finance";
import { ESCOPOS_BENCHMARK, type Benchmark } from "../data/benchmark";

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

/** % do CDI do benchmark da operação (100% quando não há cadastro aplicável) */
export function pctBenchmark(op: Operacao, cadastro: Benchmark[], data: string): number {
  return benchmarkDaOperacao(op, cadastro, data)?.pctCDI ?? 1;
}

export type SituacaoBenchmark = "acima" | "em linha" | "abaixo";

/** Compara % do CDI realizado com o benchmark (tolerância de 0,5 p.p. do CDI) */
export function situacaoBenchmark(realizado: number, benchmark: number): SituacaoBenchmark {
  const dif = realizado - benchmark;
  if (dif > 0.005) return "acima";
  if (dif < -0.005) return "abaixo";
  return "em linha";
}

export interface ComparacaoBenchmark {
  /** fração do CDI do benchmark (média ponderada no caso da carteira) */
  pct: number;
  /** % do CDI bruto realizado */
  realizado: number;
  /** rendimento que o benchmark teria gerado sobre a mesma base (R$) */
  rendBenchmark: number;
  /** rendimento realizado − rendimento do benchmark (R$) */
  excesso: number;
  situacao: SituacaoBenchmark;
}

/** Benchmark × realizado de uma operação no período (mesma base e mesmo CDI do período) */
export function compararOperacao(r: RentabOp, cadastro: Benchmark[], data: string): ComparacaoBenchmark {
  const pct = pctBenchmark(r.op, cadastro, data);
  const rendBenchmark = r.base * r.cdiPeriodo * pct;
  return {
    pct,
    realizado: r.pctCDIBruto,
    rendBenchmark,
    excesso: r.rendimento - rendBenchmark,
    situacao: situacaoBenchmark(r.pctCDIBruto, pct),
  };
}

/** Benchmark da carteira: % do CDI ponderado pela mesma base do % do CDI realizado (Σ base × CDI do período) */
export function compararCarteira(linhas: RentabOp[], cadastro: Benchmark[], data: string): ComparacaoBenchmark {
  let peso = 0;
  let rendBenchmark = 0;
  let rendimento = 0;
  for (const r of linhas) {
    const w = r.base * r.cdiPeriodo;
    peso += w;
    rendBenchmark += w * pctBenchmark(r.op, cadastro, data);
    rendimento += r.rendimento;
  }
  const pct = peso > 0 ? rendBenchmark / peso : 1;
  const realizado = peso > 0 ? rendimento / peso : 0;
  return { pct, realizado, rendBenchmark, excesso: rendimento - rendBenchmark, situacao: situacaoBenchmark(realizado, pct) };
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
