import type { PremissasMercado as Premissas } from "../../shared/data/mercado";
import { addDays, diffDays } from "../../shared/lib/dates";
import { chavePremissas } from "../../shared/lib/taxas";
import { OPERACOES, type ClassificacaoCPC48, type Rating } from "../data/carteira";
import { FUNDOS, type Fundo } from "../data/fundos";
import { PARAMETROS_TESOURO, TIPOS_TITULO, TITULOS, type TituloPublico } from "../data/tesouro";
import { TIME_DEPOSITS, type TimeDeposit } from "../data/timeDeposits";
import { ALIQUOTA_IRPJ_CSLL } from "../data/tributacao";
import type { ChaveBenchmark } from "./benchmark";
import {
  aliquotaIR,
  ativaEm,
  calcularPosicao,
  dataFim,
  FAIXAS_PRAZO,
  fatorCDI,
  movimentacao,
  rentabilidade,
  taxaAnualEquivalente,
  taxaContratada,
  valorBruto,
  type FaixaPrazo,
} from "./finance";
import { historicoFundo, posicaoFundo } from "./fundos";
import { eventosTitulo, posicaoTitulo } from "./tesouro";
import { posicaoTimeDeposit, resgateTimeDeposit } from "./timeDeposit";

/**
 * Carteira-Mestre – base consolidada de todos os contratos de aplicação (renda fixa bancária, títulos públicos,
 * fundos e time deposits) padronizada em R$: curva, mercado, MTM, rendimentos, tributos, taxas, valor contábil e
 * grupo econômico. Alimenta R02, R03 (consolidado por tipo), R05, R06, R07, R11, R12 e os painéis de KPIs.
 *
 * Saldo "bruto" (base da movimentação): curva na renda fixa e nos títulos públicos, valor da cota nos fundos e saldo
 * em moeda × PTAX nos time deposits. Valor contábil: curva no custo amortizado e mercado no valor justo.
 */

export type TipoContrato = "Renda fixa bancária" | "Tesouro Direto" | "Fundo de investimento" | "Time deposit";
export type Moeda = "BRL" | "USD" | "EUR";

export const TIPOS_CONTRATO: { tipo: TipoContrato; origem: string; rota: string; cor: string; curto: string }[] = [
  { tipo: "Renda fixa bancária", origem: "R01", rota: "/r01-composicao", cor: "#0070f2", curto: "Renda fixa" },
  { tipo: "Tesouro Direto", origem: "R08", rota: "/r08-tesouro", cor: "#049f9a", curto: "Tesouro" },
  { tipo: "Fundo de investimento", origem: "R09", rota: "/r09-fundos", cor: "#8b47d7", curto: "Fundos" },
  { tipo: "Time deposit", origem: "R10", rota: "/r10-time-deposit", cor: "#c87b00", curto: "Time deposits" },
];

export const MOEDAS: Moeda[] = ["BRL", "USD", "EUR"];

export interface ContratoMestre {
  /** transação SAP */
  id: string;
  /** código exibido (transação, TD01, FI01, TDP01) */
  codigo: string;
  tipo: TipoContrato;
  origem: string;
  rota: string;
  produto: string;
  contraparte: string;
  grupo: string;
  rating: Rating;
  empresa: string;
  portfolio: string;
  moeda: Moeda;
  indexador: string;
  dataAplicacao: string;
  vencimento: string | null;
  principalME: number;
  principalBRL: number;
  saldoCurva: number;
  saldoMercado: number;
  /** mercado − curva */
  mtm: number;
  /** desde a aplicação (inclui cupons recebidos, come-cotas recolhido e variação cambial) */
  rendimentoBruto: number;
  iof: number;
  ir: number;
  taxas: number;
  rendimentoLiquido: number;
  valorContabil: number;
  cpc48: ClassificacaoCPC48;
  circulante: boolean;
  liquidezImediata: boolean;
  prazoRemanescente: number | null;
  saldoME: number;
  /** (mercado − curva) ÷ curva */
  agioDesagio: number;
  rentabLiqPeriodo: number;
  rentabLiqAA: number;
  /** taxa contratada, como exibida ("103% CDI", "IPCA + 7,55%", "4,85% a.a. (USD)") */
  taxaContratada: string;
  /** taxa bruta a.a. equivalente com o cenário das Premissas (na moeda do contrato; fundos líquidos da taxa de administração) */
  taxaAA: number;
  /** alíquota de IR vigente na data (TD: IRPJ/CSLL 34%) */
  aliqIR: number;
  faixaPrazo: FaixaPrazo;
  /** PTAX usada na conversão (1 para BRL) */
  ptax: number;
  chave: ChaveBenchmark;
}

type Escopo = "todas" | string;

const noEscopo = (empresa: string, escopo: Escopo) => escopo === "todas" || empresa === escopo;

function anualizar(r: number, dias: number): number {
  return Math.pow(1 + r, 365 / Math.max(1, dias)) - 1;
}

const pctBR = (v: number, d = 2) => (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

function faixaDoPrazo(dias: number | null): FaixaPrazo {
  if (dias === null || dias <= 30) return FAIXAS_PRAZO[0];
  if (dias <= 90) return FAIXAS_PRAZO[1];
  if (dias <= 180) return FAIXAS_PRAZO[2];
  if (dias <= 360) return FAIXAS_PRAZO[3];
  return FAIXAS_PRAZO[4];
}

/** Taxa de compra do título, como exibida */
export function taxaTituloTexto(t: TituloPublico): string {
  if (t.indexador === "Selic") return `Selic ${t.taxaCompra >= 0 ? "+" : "−"} ${pctBR(Math.abs(t.taxaCompra), 4)}%`;
  if (t.indexador === "IPCA") return `IPCA + ${pctBR(t.taxaCompra)}%`;
  return `${pctBR(t.taxaCompra)}% a.a.`;
}

/** Taxa bruta a.a. equivalente do título na compra, com o cenário das Premissas */
export function taxaTituloAA(t: TituloPublico, p: Premissas): number {
  if (t.indexador === "Selic") return (1 + p.selic) * (1 + t.taxaCompra) - 1;
  if (t.indexador === "IPCA") return (1 + p.ipca12m) * (1 + t.taxaCompra) - 1;
  return t.taxaCompra;
}

/** Rentabilidade-alvo do fundo, como exibida */
export function taxaFundoTexto(f: Fundo): string {
  const m = f.modelo;
  if (m.tipo === "pctCDI") return `${pctBR(m.pctBruto, 0)}% CDI (bruto)`;
  if (m.tipo === "cdiMais") return `CDI + ${pctBR(m.spread)}%`;
  if (m.tipo === "cambial") return `${m.moeda} + ${pctBR(m.cupom)}%`;
  return m.serie === "ibovespa" ? "Ibovespa (renda variável)" : "Multimercado (retorno absoluto)";
}

/** Retorno esperado a.a. do fundo com o cenário das Premissas, líquido da taxa de administração (cambial: sem variação da moeda) */
export function taxaFundoAA(f: Fundo, p: Premissas): number {
  const m = f.modelo;
  let bruto: number;
  if (m.tipo === "pctCDI") bruto = Math.pow(1 + (Math.pow(1 + p.cdi, 1 / 252) - 1) * m.pctBruto, 252) - 1;
  else if (m.tipo === "cdiMais") bruto = (1 + p.cdi) * (1 + m.spread) - 1;
  else if (m.tipo === "cambial") bruto = m.cupom;
  else bruto = (1 + p.cdi) * (1 + m.projecaoSpreadCDI) - 1;
  return (1 + bruto) * (1 - f.taxaAdm) - 1;
}

export function taxaTDTexto(td: TimeDeposit): string {
  return `${pctBR(td.taxa)}% a.a. (${td.moeda})`;
}

// ---------------------------------------------------------------------------
// Posições
// ---------------------------------------------------------------------------

function nomeTitulo(t: TituloPublico): string {
  return TIPOS_TITULO.find((x) => x.tipo === t.tipo)?.nome ?? t.tipo;
}

function indexadorTitulo(t: TituloPublico): string {
  return t.indexador === "Prefixado" ? "Pré" : t.indexador;
}

const cache = new Map<string, ContratoMestre[]>();

/** Contratos ativos na data, padronizados em R$ */
export function contratosMestre(data: string, p: Premissas, escopo: Escopo = "todas"): ContratoMestre[] {
  const k = `${data}|${escopo}|${chavePremissas(p)}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const out: ContratoMestre[] = [];

  for (const op of OPERACOES) {
    if (!noEscopo(op.empresa, escopo) || !ativaEm(op, data)) continue;
    const x = calcularPosicao(op, data, p);
    // IOF só quando realizado (resgate antes de 30 dias): na posição, IR sobre o rendimento pela alíquota vigente
    const irRF = x.rendimento * x.aliqIR;
    const liq = x.rendimento - irRF;
    out.push({
      id: op.transacao,
      codigo: op.transacao,
      tipo: "Renda fixa bancária",
      origem: "R01",
      rota: "/r01-composicao",
      produto: op.produto,
      contraparte: op.contraparte,
      grupo: op.grupo,
      rating: op.rating,
      empresa: op.empresa,
      portfolio: op.portfolio,
      moeda: "BRL",
      indexador: op.indexador,
      dataAplicacao: op.dataAplicacao,
      vencimento: op.dataVencimento,
      principalME: op.principal,
      principalBRL: op.principal,
      saldoCurva: x.valorBruto,
      saldoMercado: x.valorJusto,
      mtm: x.ajusteVJ,
      rendimentoBruto: x.rendimento,
      iof: 0,
      ir: irRF,
      taxas: 0,
      rendimentoLiquido: liq,
      valorContabil: x.valorContabil,
      cpc48: op.cpc48,
      circulante: x.circulante,
      liquidezImediata: x.liquidezImediata,
      prazoRemanescente: x.prazoRemanescente,
      saldoME: x.valorBruto,
      agioDesagio: op.ajusteVJ,
      rentabLiqPeriodo: liq / op.principal,
      rentabLiqAA: anualizar(liq / op.principal, x.diasCorridos),
      taxaContratada: taxaContratada(op),
      taxaAA: taxaAnualEquivalente(op, p),
      aliqIR: x.aliqIR,
      faixaPrazo: x.faixaPrazo,
      ptax: 1,
      chave: op,
    });
  }

  for (const t of TITULOS) {
    if (!noEscopo(t.empresa, escopo)) continue;
    const x = posicaoTitulo(t, data, p);
    if (!x.ativo) continue;
    const irT = irAcumTitulo(t, data, p);
    const liqT = x.rendimentoBruto - irT - x.taxas;
    out.push({
      id: t.transacao,
      codigo: t.id,
      tipo: "Tesouro Direto",
      origem: "R08",
      rota: "/r08-tesouro",
      produto: nomeTitulo(t),
      contraparte: "Tesouro Nacional",
      grupo: "Tesouro Nacional",
      rating: "Soberano",
      empresa: t.empresa,
      portfolio: t.portfolio,
      moeda: "BRL",
      indexador: indexadorTitulo(t),
      dataAplicacao: t.dataCompra,
      vencimento: t.vencimento,
      principalME: x.valorCompra,
      principalBRL: x.valorCompra,
      saldoCurva: x.saldoCurva,
      saldoMercado: x.saldoMercado,
      mtm: x.mtm,
      rendimentoBruto: x.rendimentoBruto,
      iof: 0,
      ir: irT,
      taxas: x.taxas,
      rendimentoLiquido: liqT,
      valorContabil: x.valorContabil,
      cpc48: t.cpc48,
      // VJ por resultado (mantido para negociação) é circulante, como na renda fixa (CPC 26, item 66)
      circulante: t.cpc48 === "VJ por Resultado" || x.prazoRemanescente <= 365,
      liquidezImediata: true,
      prazoRemanescente: x.prazoRemanescente,
      saldoME: x.saldoCurva,
      agioDesagio: x.saldoCurva > 0 ? x.mtm / x.saldoCurva : 0,
      rentabLiqPeriodo: liqT / x.valorCompra,
      rentabLiqAA: anualizar(liqT / x.valorCompra, x.diasCorridos),
      taxaContratada: taxaTituloTexto(t),
      taxaAA: taxaTituloAA(t, p),
      aliqIR: aliquotaIR(x.diasCorridos, "Regressivo"),
      faixaPrazo: faixaDoPrazo(x.prazoRemanescente),
      ptax: 1,
      chave: { transacao: t.transacao, empresa: t.empresa, portfolio: t.portfolio, produto: nomeTitulo(t) },
    });
  }

  for (const f of FUNDOS) {
    if (!noEscopo(f.empresa, escopo)) continue;
    const x = posicaoFundo(f, data, p);
    if (!x.ativo) continue;
    const irF = irAcumFundo(f, data, p);
    const liqF = x.rendimentoBruto - irF;
    const rentF = f.valorAplicado > 0 ? liqF / f.valorAplicado : 0;
    out.push({
      id: f.transacao,
      codigo: f.id,
      tipo: "Fundo de investimento",
      origem: "R09",
      rota: "/r09-fundos",
      produto: f.nome,
      contraparte: f.gestor,
      grupo: f.grupo,
      rating: f.rating,
      empresa: f.empresa,
      portfolio: f.portfolio,
      moeda: "BRL",
      indexador: f.indexador,
      dataAplicacao: f.dataAplicacao,
      vencimento: null,
      principalME: f.valorAplicado,
      principalBRL: f.valorAplicado,
      saldoCurva: x.saldo,
      saldoMercado: x.saldo,
      mtm: 0,
      rendimentoBruto: x.rendimentoBruto,
      iof: 0,
      ir: irF,
      taxas: 0,
      rendimentoLiquido: liqF,
      valorContabil: x.saldo,
      cpc48: f.cpc48,
      circulante: true,
      liquidezImediata: x.liquidezImediata,
      prazoRemanescente: null,
      saldoME: x.saldo,
      agioDesagio: 0,
      rentabLiqPeriodo: rentF,
      rentabLiqAA: anualizar(rentF, x.diasCorridos),
      taxaContratada: taxaFundoTexto(f),
      taxaAA: taxaFundoAA(f, p),
      aliqIR: x.aliquotaIR,
      faixaPrazo: faixaDoPrazo(f.diasResgate),
      ptax: 1,
      chave: { transacao: f.transacao, empresa: f.empresa, portfolio: f.portfolio, produto: f.produto },
    });
  }

  for (const td of TIME_DEPOSITS) {
    if (!noEscopo(td.empresa, escopo)) continue;
    const x = posicaoTimeDeposit(td, data, p);
    if (!x.ativo) continue;
    const rent = x.rendimentoLiquido / x.principalBRL;
    out.push({
      id: td.transacao,
      codigo: td.id,
      tipo: "Time deposit",
      origem: "R10",
      rota: "/r10-time-deposit",
      produto: "Time deposit",
      contraparte: td.banco,
      grupo: td.grupo,
      rating: td.rating,
      empresa: td.empresa,
      portfolio: td.portfolio,
      moeda: td.moeda,
      indexador: `Pré (${td.moeda})`,
      dataAplicacao: td.dataAplicacao,
      vencimento: td.vencimento,
      principalME: td.principal,
      principalBRL: x.principalBRL,
      saldoCurva: x.saldoBRL,
      saldoMercado: x.saldoBRL,
      mtm: 0,
      rendimentoBruto: x.rendimentoBruto,
      iof: x.iofCambio,
      ir: x.irpjCsll,
      taxas: x.tarifa,
      rendimentoLiquido: x.rendimentoLiquido,
      valorContabil: x.saldoBRL,
      cpc48: td.cpc48,
      circulante: x.prazoRemanescente <= 365,
      liquidezImediata: x.prazoRemanescente <= 30,
      prazoRemanescente: x.prazoRemanescente,
      saldoME: x.saldoME,
      agioDesagio: 0,
      rentabLiqPeriodo: rent,
      rentabLiqAA: anualizar(rent, x.diasCorridos),
      taxaContratada: taxaTDTexto(td),
      taxaAA: td.taxa,
      aliqIR: ALIQUOTA_IRPJ_CSLL,
      faixaPrazo: faixaDoPrazo(x.prazoRemanescente),
      ptax: x.ptax,
      chave: { transacao: td.transacao, empresa: td.empresa, portfolio: td.portfolio, produto: "Time deposit" },
    });
  }

  cache.set(k, out);
  return out;
}

export function somaMestre(cs: ContratoMestre[], campo: keyof ContratoMestre): number {
  return cs.reduce((s, c) => s + (typeof c[campo] === "number" ? (c[campo] as number) : 0), 0);
}

// ---------------------------------------------------------------------------
// Saldo bruto e movimentação
// ---------------------------------------------------------------------------

function saldoTitulo(t: TituloPublico, d: string, p: Premissas): number {
  return posicaoTitulo(t, d, p).saldoCurva;
}
function saldoFundo(f: Fundo, d: string, p: Premissas): number {
  return posicaoFundo(f, d, p).saldo;
}
function saldoTD(td: TimeDeposit, d: string, p: Premissas): number {
  return posicaoTimeDeposit(td, d, p).saldoBRL;
}

export type TipoEvento = "Aplicação" | "Resgate" | "Vencimento" | "Cupom" | "Come-cotas";

export interface EventoMestre {
  data: string;
  tipo: TipoEvento;
  tipoContrato: TipoContrato;
  codigo: string;
  produto: string;
  contraparte: string;
  empresa: string;
  /** valor bruto movimentado (aplicação, resgate, cupom) ou IR do come-cotas */
  bruto: number;
  ir: number;
  iof: number;
  liquido: number;
}

export interface MovMestre {
  inicio: string;
  fim: string;
  saldoInicial: number;
  aplicacoes: number;
  /** resgates, vencimentos e cupons pelo valor bruto */
  resgatesBrutos: number;
  resgatesLiquidos: number;
  /** IR retido na fonte: resgates, cupons e come-cotas */
  irrf: number;
  /** parcela do IRRF recolhida no come-cotas (redução de cotas, sem saída de caixa) */
  comeCotas: number;
  iof: number;
  /** SF − SI − aplicações + resgates brutos + come-cotas */
  rendimentos: number;
  saldoFinal: number;
}

function vazio(inicio: string, fim: string): MovMestre {
  return { inicio, fim, saldoInicial: 0, aplicacoes: 0, resgatesBrutos: 0, resgatesLiquidos: 0, irrf: 0, comeCotas: 0, iof: 0, rendimentos: 0, saldoFinal: 0 };
}

function somar(a: MovMestre, b: MovMestre): MovMestre {
  return {
    inicio: a.inicio,
    fim: a.fim,
    saldoInicial: a.saldoInicial + b.saldoInicial,
    aplicacoes: a.aplicacoes + b.aplicacoes,
    resgatesBrutos: a.resgatesBrutos + b.resgatesBrutos,
    resgatesLiquidos: a.resgatesLiquidos + b.resgatesLiquidos,
    irrf: a.irrf + b.irrf,
    comeCotas: a.comeCotas + b.comeCotas,
    iof: a.iof + b.iof,
    rendimentos: a.rendimentos + b.rendimentos,
    saldoFinal: a.saldoFinal + b.saldoFinal,
  };
}

function fechar(m: MovMestre): MovMestre {
  m.resgatesLiquidos = m.resgatesBrutos - (m.irrf - m.comeCotas) - m.iof;
  m.rendimentos = m.saldoFinal - m.saldoInicial - m.aplicacoes + m.resgatesBrutos + m.comeCotas;
  return m;
}

export interface MovimentacaoMestre {
  total: MovMestre;
  porTipo: Record<TipoContrato, MovMestre>;
  eventos: EventoMestre[];
}

const cacheMov = new Map<string, MovimentacaoMestre>();

/** Movimentação consolidada em (inicio, fim] – identidade: SF = SI + aplicações + rendimentos − resgates brutos − come-cotas */
export function movimentacaoMestre(inicio: string, fim: string, p: Premissas, escopo: Escopo = "todas"): MovimentacaoMestre {
  const k = `${inicio}|${fim}|${escopo}|${chavePremissas(p)}`;
  const hit = cacheMov.get(k);
  if (hit) return hit;
  const dentro = (d: string) => d > inicio && d <= fim;
  const eventos: EventoMestre[] = [];

  // Renda fixa bancária (motor do R01/R02)
  const ops = OPERACOES.filter((o) => noEscopo(o.empresa, escopo));
  const m = movimentacao(ops, inicio, fim, p);
  const rf: MovMestre = fechar({
    ...vazio(inicio, fim),
    saldoInicial: m.saldoInicial,
    aplicacoes: m.aplicacoes,
    resgatesBrutos: m.resgatesBrutos,
    irrf: m.irrf,
    iof: m.iof,
    saldoFinal: m.saldoFinal,
  });
  for (const o of m.novasAplicacoes)
    eventos.push({ data: o.dataAplicacao, tipo: "Aplicação", tipoContrato: "Renda fixa bancária", codigo: o.transacao, produto: o.produto, contraparte: o.contraparte, empresa: o.empresa, bruto: o.principal, ir: 0, iof: 0, liquido: o.principal });
  for (const r of m.resgates)
    eventos.push({ data: r.data, tipo: "Resgate", tipoContrato: "Renda fixa bancária", codigo: r.op.transacao, produto: r.op.produto, contraparte: r.op.contraparte, empresa: r.op.empresa, bruto: r.bruto, ir: r.ir, iof: r.iof, liquido: r.liquido });

  // Títulos públicos
  const td = vazio(inicio, fim);
  for (const t of TITULOS) {
    if (!noEscopo(t.empresa, escopo)) continue;
    td.saldoInicial += saldoTitulo(t, inicio, p);
    td.saldoFinal += saldoTitulo(t, fim, p);
    if (dentro(t.dataCompra)) {
      const v = posicaoTitulo(t, t.dataCompra, p).valorCompra;
      td.aplicacoes += v;
      eventos.push({ data: t.dataCompra, tipo: "Aplicação", tipoContrato: "Tesouro Direto", codigo: t.id, produto: nomeTitulo(t), contraparte: "Tesouro Nacional", empresa: t.empresa, bruto: v, ir: 0, iof: 0, liquido: v });
    }
    for (const e of eventosTitulo(t, p)) {
      if (!dentro(e.data)) continue;
      td.resgatesBrutos += e.bruto;
      td.irrf += e.ir;
      eventos.push({ data: e.data, tipo: e.tipo, tipoContrato: "Tesouro Direto", codigo: t.id, produto: nomeTitulo(t), contraparte: "Tesouro Nacional", empresa: t.empresa, bruto: e.bruto, ir: e.ir, iof: 0, liquido: e.liquido });
    }
  }
  fechar(td);

  // Fundos
  const fi = vazio(inicio, fim);
  for (const f of FUNDOS) {
    if (!noEscopo(f.empresa, escopo)) continue;
    fi.saldoInicial += saldoFundo(f, inicio, p);
    fi.saldoFinal += saldoFundo(f, fim, p);
    if (dentro(f.dataAplicacao)) {
      fi.aplicacoes += f.valorAplicado;
      eventos.push({ data: f.dataAplicacao, tipo: "Aplicação", tipoContrato: "Fundo de investimento", codigo: f.id, produto: f.nome, contraparte: f.gestor, empresa: f.empresa, bruto: f.valorAplicado, ir: 0, iof: 0, liquido: f.valorAplicado });
    }
    const h = historicoFundo(f, p);
    for (const c of h.comeCotas) {
      if (!dentro(c.data)) continue;
      fi.irrf += c.ir;
      fi.comeCotas += c.ir;
      eventos.push({ data: c.data, tipo: "Come-cotas", tipoContrato: "Fundo de investimento", codigo: f.id, produto: f.nome, contraparte: f.gestor, empresa: f.empresa, bruto: c.ir, ir: c.ir, iof: 0, liquido: 0 });
    }
    if (h.resgate && dentro(h.resgate.data)) {
      const r = h.resgate;
      fi.resgatesBrutos += r.bruto;
      fi.irrf += r.irComplementar;
      fi.iof += r.iof;
      eventos.push({ data: r.data, tipo: "Resgate", tipoContrato: "Fundo de investimento", codigo: f.id, produto: f.nome, contraparte: f.gestor, empresa: f.empresa, bruto: r.bruto, ir: r.irComplementar, iof: r.iof, liquido: r.liquido });
    }
  }
  fechar(fi);

  // Time deposits
  const tdp = vazio(inicio, fim);
  for (const d of TIME_DEPOSITS) {
    if (!noEscopo(d.empresa, escopo)) continue;
    tdp.saldoInicial += saldoTD(d, inicio, p);
    tdp.saldoFinal += saldoTD(d, fim, p);
    if (dentro(d.dataAplicacao)) {
      const v = d.principal * d.ptaxAplicacao;
      tdp.aplicacoes += v;
      eventos.push({ data: d.dataAplicacao, tipo: "Aplicação", tipoContrato: "Time deposit", codigo: d.id, produto: `Time deposit ${d.moeda}`, contraparte: d.banco, empresa: d.empresa, bruto: v, ir: 0, iof: 0, liquido: v });
    }
    if (dentro(d.vencimento)) {
      const r = resgateTimeDeposit(d, p);
      tdp.resgatesBrutos += r.bruto;
      eventos.push({ data: d.vencimento, tipo: "Vencimento", tipoContrato: "Time deposit", codigo: d.id, produto: `Time deposit ${d.moeda}`, contraparte: d.banco, empresa: d.empresa, bruto: r.bruto, ir: 0, iof: 0, liquido: r.bruto });
    }
  }
  fechar(tdp);

  const porTipo: Record<TipoContrato, MovMestre> = {
    "Renda fixa bancária": rf,
    "Tesouro Direto": td,
    "Fundo de investimento": fi,
    "Time deposit": tdp,
  };
  const total = fechar(Object.values(porTipo).reduce((a, b) => somar(a, b), vazio(inicio, fim)));
  eventos.sort((a, b) => a.data.localeCompare(b.data) || a.codigo.localeCompare(b.codigo));
  const r = { total, porTipo, eventos };
  cacheMov.set(k, r);
  return r;
}

export interface MesMestre extends MovMestre {
  cdiMes: number;
  /** rendimentos ÷ capital médio (SI + ½ × (aplicações − resgates brutos)) */
  rentabMes: number;
  pctCDI: number;
  porTipo: Record<TipoContrato, MovMestre>;
  eventos: EventoMestre[];
}

/** Evolução mensal consolidada (R05): um registro por fim de mês */
export function evolucaoMestre(fimMeses: string[], p: Premissas, escopo: Escopo = "todas"): MesMestre[] {
  return fimMeses.map((fim) => {
    const inicio = addDays(`${fim.slice(0, 7)}-01`, -1);
    const mv = movimentacaoMestre(inicio, fim, p, escopo);
    const cdiMes = fatorCDI(inicio, fim, p) - 1;
    const base = mv.total.saldoInicial + 0.5 * (mv.total.aplicacoes - mv.total.resgatesBrutos);
    const rentabMes = base > 0 ? mv.total.rendimentos / base : 0;
    return { ...mv.total, cdiMes, rentabMes, pctCDI: cdiMes > 0 ? rentabMes / cdiMes : 0, porTipo: mv.porTipo, eventos: mv.eventos };
  });
}

// ---------------------------------------------------------------------------
// Rentabilidade no período (R03 consolidado por tipo, benchmark consolidado)
// ---------------------------------------------------------------------------

export interface RentabContrato {
  op: ChaveBenchmark;
  codigo: string;
  tipo: TipoContrato;
  produto: string;
  contraparte: string;
  moeda: Moeda;
  status: "Ativa" | "Liquidada";
  inicio: string;
  fim: string;
  dias: number;
  /** saldo bruto no início do período (ou valor aplicado, se posterior) */
  base: number;
  /** variação do saldo + fluxos recebidos (cupons, resgates, come-cotas) no período */
  rendimento: number;
  iof: number;
  ir: number;
  taxas: number;
  rendLiquido: number;
  cdiPeriodo: number;
  pctCDIBruto: number;
  rentabBruta: number;
  rentabLiquida: number;
}

function linha(
  base: Omit<RentabContrato, "rendLiquido" | "cdiPeriodo" | "pctCDIBruto" | "rentabBruta" | "rentabLiquida" | "dias">,
  p: Premissas,
): RentabContrato {
  const cdiPeriodo = fatorCDI(base.inicio, base.fim, p) - 1;
  const rendLiquido = base.rendimento - base.iof - base.ir - base.taxas;
  const rentabBruta = base.base > 0 ? base.rendimento / base.base : 0;
  return {
    ...base,
    dias: diffDays(base.inicio, base.fim),
    rendLiquido,
    cdiPeriodo,
    pctCDIBruto: cdiPeriodo > 0 ? rentabBruta / cdiPeriodo : 0,
    rentabBruta,
    rentabLiquida: base.base > 0 ? rendLiquido / base.base : 0,
  };
}

/**
 * IR acumulado (retido na fonte + provisão) desde a aplicação até a data. O IR de um período é a variação desse
 * acumulado: em mês de perda (ou de mudança de faixa) a provisão é revertida, e a soma dos meses fecha com o total.
 */
function irAcumTitulo(t: TituloPublico, d: string, p: Premissas): number {
  if (d <= t.dataCompra) return 0;
  const eventos = eventosTitulo(t, p);
  const venc = eventos[eventos.length - 1];
  if (d >= venc.data) return eventos.reduce((a, e) => a + e.ir, 0);
  // IR retido nos cupons + provisão sobre o rendimento ainda não tributado (sem IOF provisório: só se realizado)
  const x = posicaoTitulo(t, d, p);
  const recebidos = eventos.filter((e) => e.data <= d);
  const baseCupons = recebidos.reduce((a, e) => a + e.base, 0);
  const irCupons = recebidos.reduce((a, e) => a + e.ir, 0);
  return irCupons + Math.max(0, x.rendimentoBruto - baseCupons) * aliquotaIR(x.diasCorridos, "Regressivo");
}

function irAcumFundo(f: Fundo, d: string, p: Premissas): number {
  if (d <= f.dataAplicacao) return 0;
  const h = historicoFundo(f, p);
  if (h.resgate && d >= h.resgate.data) return h.comeCotas.reduce((a, c) => a + c.ir, 0) + h.resgate.irComplementar;
  const x = posicaoFundo(f, d, p);
  return Math.max(0, x.rendimentoBruto) * x.aliquotaIR;
}

function irAcumTD(td: TimeDeposit, d: string, p: Premissas): number {
  if (d <= td.dataAplicacao) return 0;
  if (d >= td.vencimento) {
    const ap = posicaoTimeDeposit(td, td.dataAplicacao, p);
    return Math.max(0, resgateTimeDeposit(td, p).bruto - ap.principalBRL - ap.iofCambio - ap.tarifa) * ALIQUOTA_IRPJ_CSLL;
  }
  return posicaoTimeDeposit(td, d, p).irpjCsll;
}

const cacheRent = new Map<string, RentabContrato[]>();

/** Rendimento de cada contrato no período (inicio, fim], inclusive os liquidados no período */
export function rentabilidadeMestre(inicio: string, fim: string, p: Premissas, escopo: Escopo = "todas"): RentabContrato[] {
  const k = `${inicio}|${fim}|${escopo}|${chavePremissas(p)}`;
  const hit = cacheRent.get(k);
  if (hit) return hit;
  const out: RentabContrato[] = [];

  for (const r of rentabilidade(OPERACOES.filter((o) => noEscopo(o.empresa, escopo)), inicio, fim, p)) {
    out.push(
      linha(
        {
          op: r.op,
          codigo: r.op.transacao,
          tipo: "Renda fixa bancária",
          produto: r.op.produto,
          contraparte: r.op.contraparte,
          moeda: "BRL",
          status: r.status,
          inicio: r.inicio,
          fim: r.fim,
          base: r.base,
          rendimento: r.rendimento,
          iof: r.iof,
          ir: r.ir,
          taxas: 0,
        },
        p,
      ),
    );
  }

  for (const t of TITULOS) {
    if (!noEscopo(t.empresa, escopo)) continue;
    const venc = eventosTitulo(t, p).find((e) => e.tipo === "Vencimento")!;
    if (t.dataCompra > fim || venc.data <= inicio) continue;
    const s = t.dataCompra > inicio ? t.dataCompra : inicio;
    const e = venc.data < fim ? venc.data : fim;
    const pos0 = posicaoTitulo(t, s, p);
    const base = t.dataCompra > inicio ? pos0.valorCompra : pos0.saldoCurva;
    const fluxos = eventosTitulo(t, p).filter((x) => x.data > s && x.data <= e);
    const final = posicaoTitulo(t, e, p);
    const rendimento = final.saldoCurva + fluxos.reduce((a, x) => a + x.bruto, 0) - base;
    // títulos são carregados além de 30 dias: sem IOF realizado; IR = variação do IR acumulado (retido + provisão)
    const iof = 0;
    const ir = irAcumTitulo(t, e, p) - irAcumTitulo(t, s, p);
    const taxas = ((base + final.saldoCurva) / 2) * (PARAMETROS_TESOURO.custodiaB3 + PARAMETROS_TESOURO.taxaAgente) * (diffDays(s, e) / 365);
    out.push(
      linha(
        {
          op: { transacao: t.transacao, empresa: t.empresa, portfolio: t.portfolio, produto: nomeTitulo(t) },
          codigo: t.id,
          tipo: "Tesouro Direto",
          produto: nomeTitulo(t),
          contraparte: "Tesouro Nacional",
          moeda: "BRL",
          status: venc.data <= fim ? "Liquidada" : "Ativa",
          inicio: s,
          fim: e,
          base,
          rendimento,
          iof,
          ir,
          taxas,
        },
        p,
      ),
    );
  }

  for (const f of FUNDOS) {
    if (!noEscopo(f.empresa, escopo)) continue;
    const fimFundo = f.dataResgate ?? null;
    if (f.dataAplicacao > fim || (fimFundo !== null && fimFundo <= inicio)) continue;
    const s = f.dataAplicacao > inicio ? f.dataAplicacao : inicio;
    const e = fimFundo !== null && fimFundo < fim ? fimFundo : fim;
    const h = historicoFundo(f, p);
    const base = f.dataAplicacao > inicio ? f.valorAplicado : posicaoFundo(f, s, p).saldo;
    const cc = h.comeCotas.filter((c) => c.data > s && c.data <= e).reduce((a, c) => a + c.ir, 0);
    const resg = h.resgate && h.resgate.data > s && h.resgate.data <= e ? h.resgate : null;
    const saldoFinal = posicaoFundo(f, e, p).saldo;
    const rendimento = saldoFinal + cc + (resg?.bruto ?? 0) - base;
    // IOF só no resgate (realizado); IR = variação do IR acumulado (come-cotas + provisão/IR complementar)
    const iof = resg?.iof ?? 0;
    const ir = irAcumFundo(f, e, p) - irAcumFundo(f, s, p);
    out.push(
      linha(
        {
          op: { transacao: f.transacao, empresa: f.empresa, portfolio: f.portfolio, produto: f.produto },
          codigo: f.id,
          tipo: "Fundo de investimento",
          produto: f.nome,
          contraparte: f.gestor,
          moeda: "BRL",
          status: resg ? "Liquidada" : "Ativa",
          inicio: s,
          fim: e,
          base,
          rendimento,
          iof,
          ir,
          taxas: 0,
        },
        p,
      ),
    );
  }

  for (const d of TIME_DEPOSITS) {
    if (!noEscopo(d.empresa, escopo)) continue;
    if (d.dataAplicacao > fim || d.vencimento <= inicio) continue;
    const s = d.dataAplicacao > inicio ? d.dataAplicacao : inicio;
    const e = d.vencimento < fim ? d.vencimento : fim;
    const aplicadoNoPeriodo = d.dataAplicacao > inicio;
    const base = aplicadoNoPeriodo ? d.principal * d.ptaxAplicacao : posicaoTimeDeposit(d, s, p).saldoBRL;
    const venceu = d.vencimento <= fim;
    const final = venceu ? resgateTimeDeposit(d, p).bruto : posicaoTimeDeposit(d, e, p).saldoBRL;
    const rendimento = final - base;
    const pos = posicaoTimeDeposit(d, d.dataAplicacao, p);
    const iof = aplicadoNoPeriodo ? pos.iofCambio : 0;
    const taxas = aplicadoNoPeriodo ? pos.tarifa : 0;
    const ir = irAcumTD(d, e, p) - irAcumTD(d, s, p);
    out.push(
      linha(
        {
          op: { transacao: d.transacao, empresa: d.empresa, portfolio: d.portfolio, produto: "Time deposit" },
          codigo: d.id,
          tipo: "Time deposit",
          produto: `Time deposit ${d.moeda}`,
          contraparte: d.banco,
          moeda: d.moeda,
          status: venceu ? "Liquidada" : "Ativa",
          inicio: s,
          fim: e,
          base,
          rendimento,
          iof,
          ir,
          taxas,
        },
        p,
      ),
    );
  }

  cacheRent.set(k, out);
  return out;
}

/** Soma de rendimentos por tipo de contrato, com % do CDI ponderado (Σ rendimento ÷ Σ base × CDI do período) */
export function consolidarPorTipo(linhas: RentabContrato[]) {
  return TIPOS_CONTRATO.map((t) => {
    const ls = linhas.filter((l) => l.tipo === t.tipo);
    const soma = (fn: (l: RentabContrato) => number) => ls.reduce((s, l) => s + fn(l), 0);
    const peso = soma((l) => l.base * l.cdiPeriodo);
    const base = soma((l) => l.base);
    const rendimento = soma((l) => l.rendimento);
    const liquido = soma((l) => l.rendLiquido);
    return {
      ...t,
      contratos: ls.length,
      base,
      rendimento,
      iof: soma((l) => l.iof),
      ir: soma((l) => l.ir),
      taxas: soma((l) => l.taxas),
      rendLiquido: liquido,
      pctCDIBruto: peso > 0 ? rendimento / peso : 0,
      pctCDILiquido: peso > 0 ? liquido / peso : 0,
    };
  });
}

/** Data de liquidação dos contratos da renda fixa (para listas de vencimento) */
export { dataFim, valorBruto };
