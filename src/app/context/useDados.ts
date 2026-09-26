import { useMemo } from "react";
import { OPERACOES } from "../data/carteira";
import { COVENANTS } from "../data/endividamento";
import type { Premissas } from "../data/premissas";
import { fmtDate } from "../lib/dates";
import { fmtCompact, fmtPct, fmtX } from "../lib/format";
import { analiseFiscal, posicoesEm, type Posicao } from "../lib/finance";
import {
  avaliarCovenants,
  avaliarPolitica,
  concentracaoPorGrupo,
  indicadoresTrimestre,
  trimestresAte,
} from "../lib/indicadores";
import { usePremissas } from "./PremissasContext";

export type Escopo = "todas" | string;

export const ESCOPOS: { value: Escopo; label: string }[] = [
  { value: "todas", label: "Consolidado (todas as empresas)" },
  { value: "1000", label: "1000 – Empresa ABC S.A." },
  { value: "2000", label: "2000 – ABC Logística Ltda." },
  { value: "3000", label: "3000 – ABC Energia S.A." },
];

export function operacoesDoEscopo(escopo: Escopo) {
  return escopo === "todas" ? OPERACOES : OPERACOES.filter((o) => o.empresa === escopo);
}

export function useCarteira(escopo: Escopo = "todas") {
  const { premissas } = usePremissas();
  const ops = useMemo(() => operacoesDoEscopo(escopo), [escopo]);
  const posicoes = useMemo(() => posicoesEm(ops, premissas.dataBase, premissas), [ops, premissas]);
  return { premissas, ops, posicoes };
}

export interface Alerta {
  id: string;
  severidade: "negative" | "critical" | "information";
  titulo: string;
  descricao: string;
  rota: string;
}

export function calcularAlertas(posicoes: Posicao[], p: Premissas): Alerta[] {
  const out: Alerta[] = [];

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
    const ind = indicadoresTrimestre(tri[tri.length - 1], OPERACOES, p);
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
  return useMemo(() => {
    const pos = posicoesEm(OPERACOES, premissas.dataBase, premissas);
    return calcularAlertas(pos, premissas);
  }, [premissas]);
}
