import { useMemo } from "react";
import type { Alerta } from "../../shared/context/ProdutoContext";
import type { PremissasMercado as Premissas } from "../../shared/data/mercado";
import { OPERACOES } from "../data/carteira";
import { diffDays, fmtDate, fmtQuarter, lastMonthEnds } from "../../shared/lib/dates";
import { fmtCompact, fmtDec, fmtPct, fmtX, plural } from "../../shared/lib/format";
import { analiseFiscal, posicoesEm, type Posicao } from "../lib/finance";
import { contratosMestre, rentabilidadeMestre } from "../lib/carteiraMestre";
import { FUNDOS } from "../data/fundos";
import { historicoFundo, posicaoFundo } from "../lib/fundos";
import { TIME_DEPOSITS } from "../data/timeDeposits";
import { posicaoTimeDeposit } from "../lib/timeDeposit";
import type { Benchmark } from "../data/benchmark";
import { compararCarteira, compararOperacao } from "../lib/benchmark";
import { resumoConciliacao } from "../lib/conciliacao";
import { useBenchmarks } from "./BenchmarkContext";
import {
  apurarCovenants,
  avaliarLimitesPolitica,
  avaliarPolitica,
  concentracaoPorGrupo,
  fmtLimiteCovenant,
  fmtValorCovenant,
  indicadoresTrimestre,
  rotuloApuracao,
  trimestresAte,
} from "../lib/indicadores";
import { usePremissas } from "../../shared/context/MercadoContext";

import type { Escopo } from "../../shared/data/empresas";
export { ESCOPOS, type Escopo } from "../../shared/data/empresas";

export function operacoesDoEscopo(escopo: Escopo) {
  return escopo === "todas" ? OPERACOES : OPERACOES.filter((o) => o.empresa === escopo);
}

/** Renda fixa bancária (R01/R03/R04) do escopo */
export function useCarteira(escopo: Escopo = "todas") {
  const { premissas } = usePremissas();
  const ops = useMemo(() => operacoesDoEscopo(escopo), [escopo]);
  const posicoes = useMemo(() => posicoesEm(ops, premissas.dataBase, premissas), [ops, premissas]);
  return { premissas, ops, posicoes };
}

/** Carteira consolidada (Carteira-Mestre: renda fixa, títulos públicos, fundos e time deposits) do escopo */
export function useMestre(escopo: Escopo = "todas") {
  const { premissas } = usePremissas();
  const contratos = useMemo(() => contratosMestre(premissas.dataBase, premissas, escopo), [premissas, escopo]);
  return { premissas, contratos };
}

export type { Alerta } from "../../shared/context/ProdutoContext";

/** Relatório de cada regra da política de investimentos (onde a exposição é detalhada) */
function rotaRegraPolitica(id: string): string {
  if (id === "exterior") return "/r11-moeda-tipo";
  if (id === "fundos") return "/r09-fundos";
  return "/r07-concentracao";
}

export function calcularAlertas(posicoes: Posicao[], p: Premissas, benchmarks: Benchmark[]): Alerta[] {
  const out: Alerta[] = [];
  const mestre = contratosMestre(p.dataBase, p);

  // Rentabilidade × benchmark cadastrado (% do CDI, últimos 12 meses) – carteira consolidada (Carteira-Mestre)
  const linhas = rentabilidadeMestre(lastMonthEnds(p.dataBase, 13)[0], p.dataBase, p);
  const carteira = compararCarteira(linhas, benchmarks, p);
  if (carteira.situacao === "abaixo") {
    out.push({
      id: "bmk-carteira",
      severidade: "critical",
      titulo: `Carteira abaixo do benchmark: ${fmtDec(carteira.realizado * 100, 1)}% vs ${fmtDec(carteira.pct * 100, 1)}% do CDI`,
      descricao: `Carteira consolidada, 12 meses: rendimento ${fmtCompact(Math.abs(carteira.excesso))} abaixo do que o benchmark efetivo (mix das regras) teria gerado.`,
      rota: "/benchmark",
    });
  }
  const abaixo = linhas
    .filter((r) => r.status === "Ativa")
    .map((r) => ({ r, c: compararOperacao(r, benchmarks, p) }))
    .filter((x) => x.c.realizado - x.c.pct < -0.02);
  if (abaixo.length) {
    const pior = [...abaixo].sort((a, b) => a.c.realizado - a.c.pct - (b.c.realizado - b.c.pct))[0];
    // fundos: nome do fundo (gestora entre parênteses); títulos públicos: o emissor é sempre o Tesouro Nacional
    const nome =
      pior.r.tipo === "Fundo de investimento"
        ? `${pior.r.produto} (${pior.r.contraparte})`
        : pior.r.tipo === "Tesouro Direto"
          ? pior.r.produto
          : `${pior.r.produto} ${pior.r.contraparte}`;
    out.push({
      id: "bmk-operacoes",
      severidade: "information",
      titulo: `${plural(abaixo.length, "contrato", "contratos")} mais de 2 p.p. abaixo do benchmark`,
      descricao: `Maior diferença: ${nome} com ${fmtDec(pior.c.realizado * 100, 1)}% vs ${fmtDec(pior.c.pct * 100, 1)}% do CDI (12 meses).`,
      rota: "/benchmark",
    });
  }

  // Concentração por grupo econômico e política de investimentos (R07) – carteira consolidada
  for (const g of concentracaoPorGrupo(mestre)) {
    if (g.status === "ok") continue;
    out.push({
      id: `lim-${g.grupo}`,
      severidade: g.status === "excedido" ? "negative" : "critical",
      titulo: `Limite ${g.grupo}: ${fmtPct(g.utilizacao, 0)} utilizado`,
      descricao: `Exposição de ${fmtPct(g.share, 1)} da carteira para limite de ${fmtPct(g.limite, 0)} (rating ${g.rating}).`,
      rota: "/r07-concentracao",
    });
  }
  for (const r of avaliarPolitica(mestre)) {
    if (r.status === "ok") continue;
    const max = r.tipo === "max";
    out.push({
      id: `pol-${r.id}`,
      severidade: r.status === "excedido" ? "negative" : "critical",
      titulo:
        r.status === "excedido"
          ? `Política: ${r.regra} – ${max ? "limite excedido" : "abaixo do mínimo"}`
          : `Política: ${r.regra} – perto do ${max ? "limite" : "mínimo"}`,
      descricao: `${fmtPct(r.share, 1)} da carteira vs limite ${max ? "máximo" : "mínimo"} de ${fmtPct(r.limite, 0)}.`,
      rota: rotaRegraPolitica(r.id),
    });
  }

  // Covenants contratuais da dívida (mesma apuração da carteira de captações) – R06
  for (const a of apurarCovenants(p.dataBase)) {
    if (a.status === "ok" || !a.dataApuracao) continue;
    const valor = fmtValorCovenant(a.cov, a.valor);
    const limite = fmtLimiteCovenant(a.cov);
    if (a.status === "excedido") {
      out.push({
        id: `cov-${a.cov.id}`,
        severidade: a.reclassifica ? "negative" : "critical",
        titulo: a.reclassifica
          ? `Covenant descumprido: ${a.cov.indicador} – dívida reclassificada para o circulante`
          : `Covenant descumprido com waiver: ${a.cov.indicador}`,
        descricao: a.reclassifica
          ? `${valor} vs limite ${limite} (apuração ${rotuloApuracao(a)}). Sem waiver até a data-base: não circulante de ${a.cov.contratos.join(", ")} no circulante (CPC 26, item 74).`
          : `${valor} vs limite ${limite} (apuração ${rotuloApuracao(a)}). Waiver do ${a.waiver?.credor} obtido em ${fmtDate(a.waiver?.obtidoEm)}.`,
        rota: "/r06-indicadores",
      });
    } else {
      out.push({
        id: `cov-${a.cov.id}`,
        severidade: "critical",
        titulo: `Covenant em atenção: ${a.cov.indicador} ${valor}`,
        descricao: `Limite ${limite} (apuração ${rotuloApuracao(a)}; ${a.cov.fonte}).`,
        rota: "/r06-indicadores",
      });
    }
  }
  // Limites da política financeira interna (não contratuais)
  const tri = trimestresAte(p.dataBase);
  if (tri.length) {
    for (const l of avaliarLimitesPolitica(indicadoresTrimestre(tri[tri.length - 1]))) {
      if (l.status === "ok") continue;
      out.push({
        id: `polfin-${l.id}`,
        severidade: l.status === "excedido" ? "negative" : "critical",
        titulo: `Política financeira: ${l.indicador} ${fmtX(l.valor)}`,
        descricao: `Limite interno ${l.tipo === "max" ? "≤" : "≥"} ${fmtX(l.limite)} (apuração ${fmtQuarter(tri[tri.length - 1])}).`,
        rota: "/r06-indicadores",
      });
    }
  }

  // Conciliação de fim de mês (R12): cada diferença pendente (TRM × FI-GL ou extrato) bloqueia a aprovação
  for (const pd of resumoConciliacao(p.dataBase, p).pendencias) {
    out.push({
      id: `r12-${pd.id}`,
      severidade: "critical",
      titulo: `Conciliação: ${pd.titulo}`,
      descricao: pd.descricao,
      rota: "/r12-conciliacao",
    });
  }

  // Vencimentos em até 30 dias – renda fixa bancária (R01), títulos públicos (R08) e time deposits (R10), por prazo
  const vencimentos: { prazo: number; alerta: Alerta }[] = [];
  for (const v of posicoes) {
    if (v.prazoRemanescente === null || v.prazoRemanescente < 0 || v.prazoRemanescente > 30) continue;
    vencimentos.push({
      prazo: v.prazoRemanescente,
      alerta: {
        id: `venc-${v.op.transacao}`,
        severidade: "information",
        titulo: `Vencimento em ${plural(v.prazoRemanescente, "dia", "dias")} – ${v.op.produto} ${v.op.contraparte}`,
        descricao: `${fmtCompact(v.valorBruto)} em ${fmtDate(v.op.dataVencimento)}. Planejar reinvestimento.`,
        rota: "/r01-composicao",
      },
    });
  }
  for (const c of mestre) {
    if (c.tipo === "Renda fixa bancária" || c.prazoRemanescente === null || c.prazoRemanescente < 0 || c.prazoRemanescente > 30) continue;
    vencimentos.push({
      prazo: c.prazoRemanescente,
      alerta: {
        id: `venc-${c.codigo}`,
        severidade: "information",
        titulo: `Vencimento em ${plural(c.prazoRemanescente, "dia", "dias")} – ${c.produto} ${c.contraparte}`,
        descricao: `${fmtCompact(c.saldoCurva)} em ${fmtDate(c.vencimento)}${c.moeda !== "BRL" ? ` (${c.moeda} – PTAX do dia define o valor em R$)` : ""}. Planejar reinvestimento.`,
        rota: c.rota,
      },
    });
  }
  for (const v of vencimentos.sort((a, b) => a.prazo - b.prazo)) out.push(v.alerta);

  // Come-cotas nos próximos 45 dias (R09)
  for (const f of FUNDOS) {
    const pos = posicaoFundo(f, p.dataBase, p);
    if (!pos.ativo || !pos.proximoComeCotas) continue;
    const dias = diffDays(p.dataBase, pos.proximoComeCotas);
    if (dias < 0 || dias > 45) continue;
    const ev = historicoFundo(f, p).comeCotas.find((e) => e.data === pos.proximoComeCotas);
    out.push({
      id: `cc-${f.id}`,
      severidade: "information",
      titulo: `Come-cotas em ${plural(dias, "dia", "dias")} – ${f.nome}`,
      descricao: `Antecipação de IR estimada em ${fmtCompact(ev?.ir ?? 0)} em ${fmtDate(pos.proximoComeCotas)} (redução de cotas, sem saída de caixa).`,
      rota: "/r09-fundos",
    });
  }

  // Variação cambial negativa relevante no mês (R10)
  const vcMes = TIME_DEPOSITS.map((td) => posicaoTimeDeposit(td, p.dataBase, p)).filter((x) => x.ativo).reduce((s, x) => s + x.variacaoCambialMes, 0);
  if (vcMes < -50_000) {
    out.push({
      id: "fx-mes",
      severidade: "critical",
      titulo: `Variação cambial negativa de ${fmtCompact(Math.abs(vcMes))} no mês`,
      descricao: "Apreciação do real sobre os time deposits em USD/EUR (PTAX de fechamento × mês anterior). Avaliar hedge ou resgate.",
      rota: "/r10-time-deposit",
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
        descricao: `Aplicada há ${plural(pos.diasCorridos, "dia", "dias")}; resgate antes de D+30 sofre IOF regressivo.`,
        rota: "/r04-prazo-fiscal",
      });
    } else if (a.recomendacao === "Aguardar próxima faixa") {
      out.push({
        id: `ir-${pos.op.transacao}`,
        severidade: "information",
        titulo: `IR cai para ${fmtPct(a.proxima!.aliquota, 1)} em ${plural(a.diasAteProxima!, "dia", "dias")}`,
        descricao: `${pos.op.produto} ${pos.op.contraparte}: economia estimada de ${fmtCompact(a.economiaIR)} ao aguardar até ${fmtDate(a.dataProxima)}.`,
        rota: "/r04-prazo-fiscal",
      });
    }
  }

  // Severidade primeiro; dentro dela, a ordem de inclusão (vencimentos já em ordem de prazo) – sort estável
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
