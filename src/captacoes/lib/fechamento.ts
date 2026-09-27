import { CDI_MENSAL, IMPORTACAO_SAP, ultimoDadoNaDataBase, type PremissasMercado } from "../../shared/data/mercado";
import { previousYearEnd } from "../../shared/lib/dates";
import { CONTRATOS } from "../data/contratos";
import {
  CHECKLIST_FECHAMENTO,
  CONTAS_CONTABEIS,
  DIFERENCAS_EXTRATO,
  DIFERENCAS_GL,
  TOLERANCIA_CONCILIACAO,
  fonteExtrato,
  grupoContabil,
  type ContaContabil,
  type EtapaChecklist,
  type StatusEtapa,
} from "../data/fechamento";
import { diferencaRollforward, movimentacaoDivida, saldoContabil, type PosicaoDivida } from "./divida";

/** C05 – Fechamento e conciliação: TRM × FI-GL, TRM × extratos, checagens de integridade e checklist SAP */

export interface LinhaConciliacaoGL {
  conta: ContaContabil;
  saldoTRM: number;
  saldoGL: number;
  diferenca: number;
  status: "Conciliado" | "Divergente";
  motivo: string | null;
}

export function conciliacaoGL(pos: PosicaoDivida[], dataBase: string): LinhaConciliacaoGL[] {
  return CONTAS_CONTABEIS.map((conta) => {
    const doGrupo = pos.filter((x) => grupoContabil(x.c.modalidade) === conta.grupo);
    const soma = (fn: (x: PosicaoDivida) => number) => doGrupo.reduce((s, x) => s + fn(x), 0);
    let saldoTRM = 0;
    switch (conta.rubrica) {
      case "principalCP":
        saldoTRM = soma((x) => x.principalCirculante);
        break;
      case "juros":
        saldoTRM = soma((x) => x.jurosAPagar);
        break;
      case "custosCP":
        saldoTRM = -soma((x) => x.custosCirculante);
        break;
      case "principalLP":
        saldoTRM = soma((x) => x.principalAtualizado - x.principalCirculante);
        break;
      case "custosLP":
        saldoTRM = -soma((x) => x.custosAApropriar - x.custosCirculante);
        break;
    }
    const dif = DIFERENCAS_GL.find((d) => d.dataBase === dataBase && d.conta === conta.conta);
    const saldoGL = saldoTRM + (dif?.valor ?? 0);
    const diferenca = saldoGL - saldoTRM;
    return {
      conta,
      saldoTRM,
      saldoGL,
      diferenca,
      status: Math.abs(diferenca) <= TOLERANCIA_CONCILIACAO ? "Conciliado" : "Divergente",
      motivo: dif?.motivo ?? null,
    };
  });
}

export interface LinhaConciliacaoExtrato {
  pos: PosicaoDivida;
  fonte: string;
  saldoTRM: number; // principal atualizado + juros a pagar (saldo devedor)
  saldoExtrato: number;
  diferenca: number;
  status: "Conciliado" | "Arredondamento" | "Divergente";
  motivo: string | null;
}

/** Diferença de arredondamento determinística (−0,99 a 0,99) por contrato e data-base */
function arredondamento(chave: string): number {
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) % 1_000_003;
  return ((h % 199) - 99) / 100;
}

export function conciliacaoExtratos(pos: PosicaoDivida[], dataBase: string): LinhaConciliacaoExtrato[] {
  return pos.map((x) => {
    const saldoTRM = x.principalAtualizado + x.jurosAPagar;
    const dif = DIFERENCAS_EXTRATO.find((d) => d.dataBase === dataBase && d.contrato === x.c.id);
    const diferenca = dif ? dif.valor : arredondamento(`${x.c.id}|${dataBase}`);
    const status = Math.abs(diferenca) > TOLERANCIA_CONCILIACAO ? "Divergente" : Math.abs(diferenca) >= 0.01 ? "Arredondamento" : "Conciliado";
    return {
      pos: x,
      fonte: fonteExtrato(x.c.modalidade),
      saldoTRM,
      saldoExtrato: saldoTRM + diferenca,
      diferenca,
      status,
      motivo: dif?.motivo ?? (status === "Arredondamento" ? "Arredondamento de PU/centavos – dentro da tolerância" : null),
    };
  });
}

export interface Checagem {
  id: string;
  descricao: string;
  ok: boolean;
  detalhe: string;
}

export function checagensIntegridade(
  pos: PosicaoDivida[],
  dataBase: string,
  p: PremissasMercado,
  gl: LinhaConciliacaoGL[],
  extratos: LinhaConciliacaoExtrato[],
): Checagem[] {
  const total = pos.reduce((s, x) => s + x.saldoContabil, 0);
  const cpLp = pos.reduce((s, x) => s + x.circulante + x.naoCirculante, 0);
  const mov = movimentacaoDivida(CONTRATOS, previousYearEnd(dataBase), dataBase, p);
  const difMov = diferencaRollforward(mov.total);
  const vencidos = CONTRATOS.filter((c) => c.vencimento <= dataBase);
  const vencidosAbertos = vencidos.filter((c) => Math.abs(saldoContabil(c, dataBase, p)) > 0.01);
  const cronogramas = CONTRATOS.filter((c) => Math.abs(c.amortizacoes.reduce((s, a) => s + a.pct, 0) - 1) > 1e-9);
  const glDiv = gl.filter((l) => l.status === "Divergente");
  const extDiv = extratos.filter((l) => l.status === "Divergente");
  const fmt = (v: number) => (Math.round(v * 100) / 100 || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [
    {
      id: "cplp",
      descricao: "Circulante + não circulante = saldo pelo custo amortizado",
      ok: Math.abs(total - cpLp) < 0.01,
      detalhe: `Diferença de R$ ${fmt(total - cpLp)}`,
    },
    {
      id: "rollforward",
      descricao: "Movimentação (C01) fecha com o saldo da carteira",
      ok: Math.abs(difMov) < 0.01,
      detalhe: `Diferença de R$ ${fmt(difMov)} no roll-forward desde ${previousYearEnd(dataBase).split("-").reverse().join("/")}`,
    },
    {
      id: "juros",
      descricao: "Juros a pagar não negativos",
      ok: pos.every((x) => x.jurosAPagar >= -0.01),
      detalhe: `${pos.length} contratos verificados`,
    },
    {
      id: "custos",
      descricao: "Custos de transação a apropriar entre zero e o custo original",
      ok: pos.every((x) => x.custosAApropriar >= -0.01 && x.custosAApropriar <= x.c.custosTransacao + 0.01),
      detalhe: `${pos.length} contratos verificados`,
    },
    {
      id: "vencidos",
      descricao: "Contratos vencidos liquidados (saldo zero)",
      ok: vencidosAbertos.length === 0,
      detalhe: vencidos.length ? `${vencidos.length} ${vencidos.length === 1 ? "contrato vencido" : "contratos vencidos"}: ${vencidos.map((c) => c.id).join(", ")}` : "Nenhum contrato vencido",
    },
    {
      id: "cronograma",
      descricao: "Cronogramas de amortização somam 100% do principal",
      ok: cronogramas.length === 0,
      detalhe: `${CONTRATOS.length} contratos verificados`,
    },
    {
      id: "mercado",
      descricao: "Dados de mercado importados do SAP até a data-base",
      ok: dataBase <= IMPORTACAO_SAP.ultimoDadoDisponivel && CDI_MENSAL[dataBase.slice(0, 7)] !== undefined,
      detalhe: `Último dado disponível na data-base: ${ultimoDadoNaDataBase(dataBase).split("-").reverse().join("/")}`,
    },
    {
      id: "gl",
      descricao: `TRM × FI-GL dentro da tolerância (R$ ${fmt(TOLERANCIA_CONCILIACAO)})`,
      ok: glDiv.length === 0,
      detalhe: glDiv.length ? `${glDiv.length} ${glDiv.length === 1 ? "conta divergente" : "contas divergentes"}: ${glDiv.map((l) => l.conta.conta).join(", ")}` : `${gl.length} contas conciliadas`,
    },
    {
      id: "extratos",
      descricao: `TRM × extratos dentro da tolerância (R$ ${fmt(TOLERANCIA_CONCILIACAO)})`,
      ok: extDiv.length === 0,
      detalhe: extDiv.length ? `Divergência em ${extDiv.map((l) => l.pos.c.id).join(", ")}` : `${extratos.length} extratos conciliados`,
    },
  ];
}

export interface EtapaStatus extends EtapaChecklist {
  status: StatusEtapa;
}

/** Status do checklist: meses anteriores fechados; na data-base mais recente, conciliações dependem das exceções */
export function checklistFechamento(dataBase: string, checagens: Checagem[]): EtapaStatus[] {
  const ultimo = dataBase === IMPORTACAO_SAP.ultimoDadoDisponivel;
  const glOk = checagens.find((c) => c.id === "gl")?.ok ?? true;
  const extOk = checagens.find((c) => c.id === "extratos")?.ok ?? true;
  return CHECKLIST_FECHAMENTO.map((e) => {
    let status: StatusEtapa = "Concluído";
    if (ultimo) {
      if (e.id === "gl" && !glOk) status = "Com pendência";
      if (e.id === "extratos" && !extOk) status = "Com pendência";
      if (e.id === "aprovacao" && (!glOk || !extOk)) status = "Pendente";
    }
    return { ...e, status };
  });
}
