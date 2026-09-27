import { useMemo } from "react";
import { usePremissas } from "../../shared/context/MercadoContext";
import type { Alerta } from "../../shared/context/ProdutoContext";
import type { Escopo } from "../../shared/data/empresas";
import type { PremissasMercado } from "../../shared/data/mercado";
import { addDays, diffDays, fmtDate, previousYearEnd } from "../../shared/lib/dates";
import { fmtCompact, fmtPct, fmtX } from "../../shared/lib/format";
import { CONTRATOS, type ContratoDivida } from "../data/contratos";
import { apurarCovenants, reclassificadosEm } from "../lib/covenants";
import { eventosFuturos, posicoesDivida } from "../lib/divida";
import { checagensIntegridade, conciliacaoExtratos, conciliacaoGL } from "../lib/fechamento";

export { ESCOPOS, type Escopo } from "../../shared/data/empresas";

export function contratosDoEscopo(escopo: Escopo): ContratoDivida[] {
  return escopo === "todas" ? CONTRATOS : CONTRATOS.filter((c) => c.empresa === escopo);
}

/**
 * Carteira de captações na data-base: posições pelo custo amortizado, já com a reclassificação para o circulante
 * exigida pelo CPC 26 quando há covenant descumprido sem waiver. `abertura` = 31/12 do exercício anterior.
 */
export function useDivida(escopo: Escopo = "todas") {
  const { premissas } = usePremissas();
  const reclassificados = useMemo(() => reclassificadosEm(premissas.dataBase), [premissas.dataBase]);
  const contratos = useMemo(() => contratosDoEscopo(escopo), [escopo]);
  const posicoes = useMemo(
    () => posicoesDivida(contratos, premissas.dataBase, premissas, reclassificados),
    [contratos, premissas, reclassificados],
  );
  return { premissas, contratos, posicoes, reclassificados, abertura: previousYearEnd(premissas.dataBase) };
}

/** Apuração dos covenants (C04) na data-base */
export function useCovenants() {
  const { premissas } = usePremissas();
  return useMemo(() => apurarCovenants(premissas.dataBase), [premissas.dataBase]);
}

export function calcularAlertasCaptacoes(p: PremissasMercado): Alerta[] {
  const out: Alerta[] = [];
  const db = p.dataBase;
  const reclass = reclassificadosEm(db);
  const pos = posicoesDivida(CONTRATOS, db, p, reclass);

  for (const a of apurarCovenants(db)) {
    if (a.status === "ok" || !a.dataApuracao) continue;
    const valor = a.cov.formato === "pct" ? fmtPct(a.valor, 1) : fmtX(a.valor);
    const limite = a.cov.formato === "pct" ? fmtPct(a.cov.limite, 0) : fmtX(a.cov.limite, 1);
    if (a.status === "excedido") {
      out.push({
        id: `cov-${a.cov.id}`,
        severidade: a.reclassifica ? "negative" : "critical",
        titulo: a.reclassifica
          ? `${a.cov.indicador} descumprido – dívida reclassificada para o circulante`
          : `${a.cov.indicador} descumprido em ${fmtDate(a.dataApuracao)} – waiver obtido`,
        descricao: a.reclassifica
          ? `${valor} vs limite ${a.cov.tipo === "max" ? "≤" : "≥"} ${limite}. Sem waiver até a data-base (CPC 26, item 74): ${a.cov.contratos.join(", ")}.`
          : `${valor} vs limite ${a.cov.tipo === "max" ? "≤" : "≥"} ${limite}. Waiver do ${a.waiver?.credor} em ${fmtDate(a.waiver?.obtidoEm)}.`,
        rota: "/c04-covenants",
      });
    } else {
      out.push({
        id: `cov-${a.cov.id}`,
        severidade: "critical",
        titulo: `${a.cov.indicador} próximo do limite: ${valor}`,
        descricao: `Limite ${a.cov.tipo === "max" ? "≤" : "≥"} ${limite} (${a.cov.fonte}).`,
        rota: "/c04-covenants",
      });
    }
  }

  const limite30 = addDays(db, 30);
  for (const x of pos) {
    const ev = x.proximoPagamento;
    if (ev && ev.data <= limite30) {
      out.push({
        id: `pag-${x.c.id}`,
        severidade: "information",
        titulo: `Pagamento de ${fmtCompact(ev.principal + ev.juros)} em ${fmtDate(ev.data)} – ${x.c.id}`,
        descricao:
          ev.principal > 0.5
            ? `${x.c.instrumento}: principal ${fmtCompact(ev.principal)} + juros ${fmtCompact(ev.juros)} (projeção com o último dado disponível).`
            : `${x.c.instrumento}: pagamento de juros (projeção com o último dado disponível).`,
        rota: "/c02-cronograma",
      });
    }
  }

  const limite12m = addDays(db, 365);
  for (const x of pos) {
    if (x.c.vencimento <= limite12m) {
      out.push({
        id: `venc-${x.c.id}`,
        severidade: "critical",
        titulo: `Vencimento final de ${x.c.id} em ${diffDays(db, x.c.vencimento)} dias`,
        descricao: `${x.c.instrumento} (${fmtCompact(x.saldoContabil)}) vence em ${fmtDate(x.c.vencimento)}. Avaliar refinanciamento.`,
        rota: "/c02-cronograma",
      });
    }
    const inicioAmort = x.c.amortizacoes.find((a) => a.data > db);
    const jaAmortizou = x.c.amortizacoes.some((a) => a.data <= db);
    // contratos bullet: a primeira amortização é o próprio vencimento (já coberto pelo alerta de vencimento final)
    const bullet = inicioAmort?.data === x.c.vencimento;
    if (!jaAmortizou && !bullet && inicioAmort && inicioAmort.data <= limite12m && eventosFuturos(x.c, db, p).length > 0) {
      out.push({
        id: `car-${x.c.id}`,
        severidade: "information",
        titulo: `Fim da carência de ${x.c.id} em ${fmtDate(inicioAmort.data)}`,
        descricao: `${x.c.descricaoAmortizacao}. A parcela circulante passa a incluir o principal.`,
        rota: "/c02-cronograma",
      });
    }
    if (x.c.capitalizacaoCPC20 && x.c.capitalizacaoCPC20.ate > db && x.c.capitalizacaoCPC20.ate <= limite12m) {
      out.push({
        id: `cpc20-${x.c.id}`,
        severidade: "information",
        titulo: `Capitalização de juros (CPC 20) de ${x.c.id} termina em ${fmtDate(x.c.capitalizacaoCPC20.ate)}`,
        descricao: `Após a entrada em operação do ativo (${x.c.capitalizacaoCPC20.ativo}), os encargos passam à despesa financeira.`,
        rota: "/c03-encargos",
      });
    }
  }

  const gl = conciliacaoGL(pos, db);
  const ext = conciliacaoExtratos(pos, db);
  const checagens = checagensIntegridade(pos, db, p, gl, ext);
  for (const c of checagens.filter((x) => !x.ok)) {
    out.push({ id: `chk-${c.id}`, severidade: "critical", titulo: `Checagem de fechamento não atendida: ${c.descricao}`, descricao: c.detalhe, rota: "/c05-fechamento" });
  }

  const ordem = { negative: 0, critical: 1, information: 2 };
  return out.sort((a, b) => ordem[a.severidade] - ordem[b.severidade]);
}

export function useAlertasCaptacoes(): Alerta[] {
  const { premissas } = usePremissas();
  return useMemo(() => calcularAlertasCaptacoes(premissas), [premissas]);
}
