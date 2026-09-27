import type { PremissasMercado as Premissas } from "../../shared/data/mercado";
import { diffDays, previousMonthEnd } from "../../shared/lib/dates";
import { ptaxNaData } from "../../shared/lib/taxas";
import { PARAMETROS_TIME_DEPOSIT as P, type TimeDeposit } from "../data/timeDeposits";
import { ALIQUOTA_IRPJ_CSLL } from "../data/tributacao";

/**
 * R10 – Motor de time deposits: juros simples ACT/360 na moeda original, conversão pela PTAX (histórico importado do
 * SAP até a data-base; depois, a PTAX da data-base), variação cambial acumulada e do mês, IOF câmbio na remessa,
 * tarifa bancária e IRPJ/CSLL sobre o resultado (rendimento no exterior não tem IRRF – Lei 14.754/2023).
 */

/** Saldo na moeda original (principal + juros) ao fim do dia */
export function saldoME(td: TimeDeposit, iso: string): number {
  if (iso < td.dataAplicacao) return 0;
  const dias = Math.min(diffDays(td.dataAplicacao, iso), diffDays(td.dataAplicacao, td.vencimento));
  return td.principal * (1 + (td.taxa * dias) / P.baseDias);
}

export function ptaxTD(td: TimeDeposit, iso: string, p: Premissas): number {
  return iso <= td.dataAplicacao ? td.ptaxAplicacao : ptaxNaData(td.moeda, iso, p);
}

export interface PosicaoTimeDeposit {
  td: TimeDeposit;
  data: string;
  ativo: boolean;
  diasCorridos: number;
  prazoRemanescente: number;
  principalBRL: number;
  saldoME: number;
  jurosME: number;
  ptax: number;
  ptaxMesAnterior: number;
  saldoBRL: number;
  /** juros convertidos pela PTAX da data */
  jurosBRL: number;
  /** principal × (PTAX da data − PTAX da remessa) */
  variacaoCambial: number;
  /** variação cambial do mês sobre o saldo em moeda do fim do mês anterior */
  variacaoCambialMes: number;
  /** juros + variação cambial */
  rendimentoBruto: number;
  iofCambio: number;
  tarifa: number;
  /** provisão de IRPJ/CSLL (34%) sobre o resultado positivo */
  irpjCsll: number;
  rendimentoLiquido: number;
  valorResgateME: number;
}

export function posicaoTimeDeposit(td: TimeDeposit, iso: string, p: Premissas): PosicaoTimeDeposit {
  const ativo = td.dataAplicacao <= iso && iso < td.vencimento;
  const principalBRL = td.principal * td.ptaxAplicacao;
  const sME = ativo ? saldoME(td, iso) : 0;
  const ptax = ptaxTD(td, iso, p);
  const antMes = previousMonthEnd(iso);
  const ptaxAnt = ptaxTD(td, antMes, p);
  const saldoBRL = sME * ptax;
  const jurosME = ativo ? sME - td.principal : 0;
  const jurosBRL = jurosME * ptax;
  const variacaoCambial = ativo ? td.principal * (ptax - td.ptaxAplicacao) : 0;
  const saldoAntME = antMes >= td.dataAplicacao ? saldoME(td, antMes) : td.principal;
  const ptaxBaseMes = antMes >= td.dataAplicacao ? ptaxAnt : td.ptaxAplicacao;
  const variacaoCambialMes = ativo ? saldoAntME * (ptax - ptaxBaseMes) : 0;
  const rendimentoBruto = ativo ? saldoBRL - principalBRL : 0;
  const iofCambio = ativo ? principalBRL * P.iofCambio : 0;
  const tarifa = ativo ? P.tarifaUSD * ptaxNaData("USD", td.dataAplicacao, p) : 0;
  const irpjCsll = Math.max(0, rendimentoBruto - iofCambio - tarifa) * ALIQUOTA_IRPJ_CSLL;
  return {
    td,
    data: iso,
    ativo,
    diasCorridos: Math.max(0, diffDays(td.dataAplicacao, iso)),
    prazoRemanescente: diffDays(iso, td.vencimento),
    principalBRL,
    saldoME: sME,
    jurosME,
    ptax,
    ptaxMesAnterior: ptaxAnt,
    saldoBRL,
    jurosBRL,
    variacaoCambial,
    variacaoCambialMes,
    rendimentoBruto,
    iofCambio,
    tarifa,
    irpjCsll,
    rendimentoLiquido: rendimentoBruto - iofCambio - tarifa - irpjCsll,
    valorResgateME: saldoME(td, td.vencimento),
  };
}

/** Resgate no vencimento (R$ pela PTAX do vencimento – projetada com a PTAX da data-base quando futura) */
export function resgateTimeDeposit(td: TimeDeposit, p: Premissas) {
  const me = saldoME(td, td.vencimento);
  const ptax = ptaxTD(td, td.vencimento, p);
  return { data: td.vencimento, valorME: me, ptax, bruto: me * ptax };
}
