import { useMemo } from "react";
import type { Alerta } from "../../shared/context/ProdutoContext";
import type { PremissasMercado as Premissas } from "../../shared/data/mercado";
import { OPERACOES } from "../data/carteira";
import { fmtDate, lastMonthEnds } from "../../shared/lib/dates";
import { fmtCompact, fmtDec, fmtPct, fmtX } from "../../shared/lib/format";
import { analiseFiscal, posicoesEm, rentabilidade, type Posicao } from "../lib/finance";
import type { Benchmark } from "../data/benchmark";
import { compararCarteira, compararOperacao } from "../lib/benchmark";
import { useBenchmarks } from "./BenchmarkContext";
import {
  avaliarCovenants,
  avaliarPolitica,
  concentracaoPorGrupo,
  COVENANTS,
  indicadoresTrimestre,
  trimestresAte,
} from "../lib/indicadores";
import { usePremissas } from "../../shared/context/MercadoContext";

import type { Escopo } from "../../shared/data/empresas";
export { ESCOPOS, type Escopo } from "../../shared/data/empresas";

export function operacoesDoEscopo(escopo: Escopo) {
  return escopo === "todas" ? OPERACOES : OPERACOES.filter((o) => o.empresa === escopo);
}

export function useCarteira(escopo: Escopo = "todas") {
  const { premissas } = usePremissas();
  const ops = useMemo(() => operacoesDoEscopo(escopo), [escopo]);
  const posicoes = useMemo(() => posicoesEm(ops, premissas.dataBase, premissas), [ops, premissas]);
  return { premissas, ops, posicoes };
}

export type { Alerta } from "../../shared/context/ProdutoContext";

export function calcularAlertas(posicoes: Posicao[], p: Premissas, benchmarks: Benchmark[]): Alerta[] {
  const out: Alerta[] = [];

  // Rentabilidade × benchmark cadastrado (% do CDI, últimos 12 meses)
  const linhas = rentabilidade(OPERACOES, lastMonthEnds(p.dataBase, 13)[0], p.dataBase, p);
  const carteira = compararCarteira(linhas, benchmarks, p.dataBase);
  if (carteira.situacao === "abaixo") {
    out.push({
      id: "bmk-carteira",
      severidade: "critical",
      titulo: `Carteira abaixo do benchmark: ${fmtDec(carteira.realizado * 100, 1)}% vs ${fmtDec(carteira.pct * 100, 1)}% do CDI`,
      descricao: `Rendimento de 12 meses ${fmtCompact(Math.abs(carteira.excesso))} abaixo do que o benchmark cadastrado teria gerado.`,
      rota: "/benchmark",
    });
  }
  const abaixo = linhas.filter((r) => r.status === "Ativa").map((r) => ({ r, c: compararOperacao(r, benchmarks, p.dataBase) }))
    .filter((x) => x.c.realizado - x.c.pct < -0.02);
  if (abaixo.length) {
    const pior = abaixo.sort((a, b) => a.c.realizado - a.c.pct - (b.c.realizado - b.c.pct))[0];
    out.push({
      id: "bmk-operacoes",
      severidade: "information",
      titulo: `${abaixo.length} aplicação(ões) mais de 2 p.p. abaixo do benchmark`,
      descricao: `Maior diferença: ${pior.r.op.produto} ${pior.r.op.contraparte} com ${fmtDec(pior.c.realizado * 100, 1)}% vs ${fmtDec(pior.c.pct * 100, 1)}% do CDI (12 meses).`,
      rota: "/benchmark",
    });
  }

  // Concentração por grupo econômico (R07)
  for (const g of concentracaoPorGrupo(posicoes)) {
    if (g.status === "ok") continue;
    out.push({
      id: `lim-${g.grupo}`,
      severidade: g.status === "excedido" ? "negative" : "critical",
      titulo: `Limite ${g.grupo}: ${fmtPct(g.utilizacao, 0)} utilizado`,
      descricao: `Exposição de ${fmtPct(g.share, 1)} da carteira para limite de ${fmtPct(g.limite, 0)} (rating ${g.rating}).`,
      rota: "/r07-concentracao",
    });
  }
  for (const r of avaliarPolitica(posicoes)) {
    if (r.status === "excedido") {
      out.push({
        id: `pol-${r.id}`,
        severidade: "negative",
        titulo: `Política: ${r.regra}`,
        descricao: `${fmtPct(r.share, 1)} vs limite ${r.tipo === "max" ? "máximo" : "mínimo"} de ${fmtPct(r.limite, 0)}.`,
        rota: "/r07-concentracao",
      });
    }
  }

  // Covenants (R06)
  const tri = trimestresAte(p.dataBase);
  if (tri.length) {
    const ind = indicadoresTrimestre(tri[tri.length - 1]);
    for (const c of avaliarCovenants(ind)) {
      if (c.status === "ok") continue;
      const cov = COVENANTS.find((x) => x.id === c.id)!;
      out.push({
        id: `cov-${c.id}`,
        severidade: c.status === "excedido" ? "negative" : "critical",
        titulo: `Covenant ${cov.indicador}: ${fmtX(c.valor)}`,
        descricao: `Limite ${cov.tipo === "max" ? "≤" : "≥"} ${fmtX(cov.limite)} (${cov.fonte}).`,
        rota: "/r06-indicadores",
      });
    }
  }

  // Vencimentos próximos (R01)
  const vencendo = posicoes
    .filter((x) => x.prazoRemanescente !== null && x.prazoRemanescente >= 0 && x.prazoRemanescente <= 30)
    .sort((a, b) => a.prazoRemanescente! - b.prazoRemanescente!);
  for (const v of vencendo) {
    out.push({
      id: `venc-${v.op.transacao}`,
      severidade: "information",
      titulo: `Vencimento em ${v.prazoRemanescente} dias – ${v.op.produto} ${v.op.contraparte}`,
      descricao: `${fmtCompact(v.valorBruto)} em ${fmtDate(v.op.dataVencimento)}. Planejar reinvestimento.`,
      rota: "/r01-composicao",
    });
  }

  // Eficiência fiscal (R04)
  for (const pos of posicoes) {
    const a = analiseFiscal(pos, p);
    if (a.recomendacao === "Evitar resgate (IOF)") {
      out.push({
        id: `iof-${pos.op.transacao}`,
        severidade: "critical",
        titulo: `IOF de ${fmtPct(pos.aliqIOF, 0)} – ${pos.op.produto} ${pos.op.contraparte}`,
        descricao: `Aplicada há ${pos.diasCorridos} dias; resgate antes de D+30 sofre IOF regressivo.`,
        rota: "/r04-prazo-fiscal",
      });
    } else if (a.recomendacao === "Aguardar próxima faixa") {
      out.push({
        id: `ir-${pos.op.transacao}`,
        severidade: "information",
        titulo: `IR cai para ${fmtPct(a.proxima!.aliquota, 1)} em ${a.diasAteProxima} dias`,
        descricao: `${pos.op.produto} ${pos.op.contraparte}: economia estimada de ${fmtCompact(a.economiaIR)} ao aguardar até ${fmtDate(a.dataProxima)}.`,
        rota: "/r04-prazo-fiscal",
      });
    }
  }

  const ordem = { negative: 0, critical: 1, information: 2 };
  return out.sort((a, b) => ordem[a.severidade] - ordem[b.severidade]);
}

export function useAlertas() {
  const { premissas } = usePremissas();
  const { cadastro } = useBenchmarks();
  return useMemo(() => {
    const pos = posicoesEm(OPERACOES, premissas.dataBase, premissas);
    return calcularAlertas(pos, premissas, cadastro);
  }, [premissas, cadastro]);
}
