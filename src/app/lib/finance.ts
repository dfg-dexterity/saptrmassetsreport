import { CDI_MENSAL, TABELA_IOF, TABELA_IRRF, type Premissas, type RegimeIR } from "../data/premissas";
import type { Operacao } from "../data/carteira";
import { addDays, diffDays, fromDay, isBusinessDay, toDay } from "./dates";

// ---------------------------------------------------------------------------
// Taxas de referência
// ---------------------------------------------------------------------------

const PRIMEIRO_MES_CDI = "2024-01";

/** CDI a.a. vigente no dia: histórico até o mês da data-base; depois, o CDI das Premissas (projeção). */
function cdiDoDia(day: number, p: Premissas): number {
  const key = fromDay(day).slice(0, 7);
  if (key > p.dataBase.slice(0, 7)) return p.cdi;
  if (key < PRIMEIRO_MES_CDI) return CDI_MENSAL[PRIMEIRO_MES_CDI];
  return CDI_MENSAL[key] ?? p.cdi;
}

function selicDoDia(day: number, p: Premissas): number {
  const key = fromDay(day).slice(0, 7);
  if (key > p.dataBase.slice(0, 7)) return p.selic;
  return cdiDoDia(day, p) + 0.001;
}

// ---------------------------------------------------------------------------
// Fatores de correção
// ---------------------------------------------------------------------------

const cache = new Map<string, number>();

function premissasKey(p: Premissas) {
  return `${p.dataBase}|${p.cdi}|${p.selic}|${p.ipca12m}`;
}

/** Fator acumulado do CDI puro (100% CDI) no intervalo [from, to) */
export function fatorCDI(from: string, to: string, p: Premissas): number {
  if (to <= from) return 1;
  const key = `cdi|${from}|${to}|${premissasKey(p)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let f = 1;
  for (let d = toDay(from), end = toDay(to); d < end; d++) {
    if (isBusinessDay(d)) f *= Math.pow(1 + cdiDoDia(d, p), 1 / 252);
  }
  cache.set(key, f);
  return f;
}

/** Fator da operação entre a data de aplicação e `ate` (sem limitar ao vencimento) */
function fatorOperacao(op: Operacao, ate: string, p: Premissas): number {
  if (ate <= op.dataAplicacao) return 1;
  const key = `op|${op.transacao}|${ate}|${premissasKey(p)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const a = toDay(op.dataAplicacao);
  const b = toDay(ate);
  let f = 1;
  let du = 0;
  switch (op.indexador) {
    case "CDI":
      for (let d = a; d < b; d++) {
        if (!isBusinessDay(d)) continue;
        const diario = Math.pow(1 + cdiDoDia(d, p), 1 / 252) - 1;
        f *= 1 + diario * op.taxa;
      }
      break;
    case "Selic":
      for (let d = a; d < b; d++) {
        if (!isBusinessDay(d)) continue;
        du++;
        f *= Math.pow(1 + selicDoDia(d, p), 1 / 252);
      }
      f *= Math.pow(1 + op.taxa, du / 252);
      break;
    case "IPCA":
      for (let d = a; d < b; d++) if (isBusinessDay(d)) du++;
      f = Math.pow(1 + p.ipca12m, (b - a) / 365) * Math.pow(1 + op.taxa, du / 252);
      break;
    case "Pré":
      for (let d = a; d < b; d++) if (isBusinessDay(d)) du++;
      f = Math.pow(1 + op.taxa, du / 252);
      break;
  }
  cache.set(key, f);
  return f;
}

// ---------------------------------------------------------------------------
// Tributação
// ---------------------------------------------------------------------------

export function aliquotaIR(diasCorridos: number, regime: RegimeIR): number {
  if (regime === "Isento") return 0;
  if (regime === "15% fixo") return 0.15;
  const faixa = TABELA_IRRF.find((f) => diasCorridos >= f.de && diasCorridos <= f.ate);
  return faixa ? faixa.aliquota : 0.15;
}

export function aliquotaIOF(diasCorridos: number): number {
  if (diasCorridos >= 30) return 0;
  if (diasCorridos < 1) return 1;
  return TABELA_IOF[diasCorridos - 1];
}

export interface ProximaFaixa {
  aPartirDe: number; // dias corridos
  aliquota: number;
}

export function proximaFaixaIR(diasCorridos: number, regime: RegimeIR): ProximaFaixa | null {
  if (regime !== "Regressivo") return null;
  const prox = TABELA_IRRF.find((f) => f.de > diasCorridos);
  return prox ? { aPartirDe: prox.de, aliquota: prox.aliquota } : null;
}

// ---------------------------------------------------------------------------
// Utilidades da operação
// ---------------------------------------------------------------------------

export function dataFim(op: Operacao): string | null {
  return op.dataResgate ?? op.dataVencimento;
}

export function ativaEm(op: Operacao, data: string): boolean {
  const fim = dataFim(op);
  return op.dataAplicacao <= data && (fim === null || data < fim);
}

/** Valor bruto na curva (principal + rendimento apropriado) */
export function valorBruto(op: Operacao, data: string, p: Premissas): number {
  if (data < op.dataAplicacao) return 0;
  const fim = dataFim(op);
  const ate = fim !== null && data > fim ? fim : data;
  return op.principal * fatorOperacao(op, ate, p);
}

export function taxaContratada(op: Operacao): string {
  const pct = (v: number, d = 2) =>
    (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  switch (op.indexador) {
    case "CDI": {
      const v = Math.round(op.taxa * 1000) / 10;
      return `${pct(op.taxa, Number.isInteger(v) ? 0 : 1)}% CDI`;
    }
    case "Selic":
      return `Selic + ${pct(op.taxa)}%`;
    case "IPCA":
      return `IPCA + ${pct(op.taxa)}%`;
    case "Pré":
      return `${pct(op.taxa)}% a.a.`;
  }
}

/** Taxa bruta anual equivalente, com o cenário vigente das Premissas */
export function taxaAnualEquivalente(op: Operacao, p: Premissas): number {
  switch (op.indexador) {
    case "CDI":
      return Math.pow(1 + (Math.pow(1 + p.cdi, 1 / 252) - 1) * op.taxa, 252) - 1;
    case "Selic":
      return (1 + p.selic) * (1 + op.taxa) - 1;
    case "IPCA":
      return (1 + p.ipca12m) * (1 + op.taxa) - 1;
    case "Pré":
      return op.taxa;
  }
}

export type FaixaPrazo = "Até 30 dias" | "31 a 90 dias" | "91 a 180 dias" | "181 a 360 dias" | "Acima de 360 dias";
export const FAIXAS_PRAZO: FaixaPrazo[] = ["Até 30 dias", "31 a 90 dias", "91 a 180 dias", "181 a 360 dias", "Acima de 360 dias"];

function faixaPrazo(dias: number | null): FaixaPrazo {
  if (dias === null || dias <= 30) return "Até 30 dias";
  if (dias <= 90) return "31 a 90 dias";
  if (dias <= 180) return "91 a 180 dias";
  if (dias <= 360) return "181 a 360 dias";
  return "Acima de 360 dias";
}

// ---------------------------------------------------------------------------
// Posição (R01)
// ---------------------------------------------------------------------------

export interface Posicao {
  op: Operacao;
  diasCorridos: number;
  fator: number;
  rendimento: number; // juros provisionados
  valorBruto: number;
  aliqIOF: number;
  iof: number;
  aliqIR: number;
  ir: number;
  valorLiquido: number;
  valorJusto: number;
  ajusteVJ: number;
  valorContabil: number;
  prazoRemanescente: number | null;
  faixaPrazo: FaixaPrazo;
  circulante: boolean;
  liquidezImediata: boolean;
  taxaEfetivaAA: number;
  pctCDI: number;
}

export function calcularPosicao(op: Operacao, data: string, p: Premissas): Posicao {
  const diasCorridos = diffDays(op.dataAplicacao, data);
  const fator = fatorOperacao(op, data, p);
  const vb = op.principal * fator;
  const rendimento = vb - op.principal;
  const aliqIOF = aliquotaIOF(diasCorridos);
  const iof = rendimento * aliqIOF;
  const aliqIR = aliquotaIR(diasCorridos, op.regimeIR);
  const ir = (rendimento - iof) * aliqIR;
  const valorJusto = vb * (1 + op.ajusteVJ);
  const valorContabil = op.cpc48 === "Custo Amortizado" ? vb : valorJusto;
  const prazoRemanescente = op.dataVencimento ? diffDays(data, op.dataVencimento) : null;
  const circulante = op.cpc48 === "VJ por Resultado" || prazoRemanescente === null || prazoRemanescente <= 365;
  const liquidezImediata =
    op.liquidez !== "No vencimento" || (prazoRemanescente !== null && prazoRemanescente <= 30);
  const cdi = fatorCDI(op.dataAplicacao, data, p) - 1;
  const du = Math.max(1, Math.round(diasCorridos * (252 / 365)));
  return {
    op,
    diasCorridos,
    fator,
    rendimento,
    valorBruto: vb,
    aliqIOF,
    iof,
    aliqIR,
    ir,
    valorLiquido: vb - ir - iof,
    valorJusto,
    ajusteVJ: valorJusto - vb,
    valorContabil,
    prazoRemanescente,
    faixaPrazo: faixaPrazo(op.liquidez === "Diária" ? null : prazoRemanescente),
    circulante,
    liquidezImediata,
    taxaEfetivaAA: Math.pow(fator, 252 / du) - 1,
    pctCDI: cdi > 0 ? rendimento / op.principal / cdi : 0,
  };
}

export function posicoesEm(ops: Operacao[], data: string, p: Premissas): Posicao[] {
  return ops.filter((o) => ativaEm(o, data)).map((o) => calcularPosicao(o, data, p));
}

// ---------------------------------------------------------------------------
// Movimentação (R02 / R05)
// ---------------------------------------------------------------------------

export interface Resgate {
  op: Operacao;
  data: string;
  bruto: number;
  rendimento: number;
  ir: number;
  iof: number;
  liquido: number;
}

export interface Movimentacao {
  inicio: string;
  fim: string;
  saldoInicial: number;
  aplicacoes: number;
  resgatesBrutos: number;
  resgatesLiquidos: number;
  irrf: number;
  iof: number;
  rendimentos: number;
  saldoFinal: number;
  resgates: Resgate[];
  novasAplicacoes: Operacao[];
}

export function resgateDe(op: Operacao, p: Premissas): Resgate | null {
  const fim = dataFim(op);
  if (!fim) return null;
  const bruto = valorBruto(op, fim, p);
  const rendimento = bruto - op.principal;
  const dias = diffDays(op.dataAplicacao, fim);
  const iof = rendimento * aliquotaIOF(dias);
  const ir = (rendimento - iof) * aliquotaIR(dias, op.regimeIR);
  return { op, data: fim, bruto, rendimento, ir, iof, liquido: bruto - ir - iof };
}

/** Movimentação no período (inicio, fim] – identidade: SF = SI + Aplicações + Rendimentos − Resgates brutos */
export function movimentacao(ops: Operacao[], inicio: string, fim: string, p: Premissas): Movimentacao {
  const saldo = (d: string) => ops.filter((o) => ativaEm(o, d)).reduce((s, o) => s + valorBruto(o, d, p), 0);
  const novas = ops.filter((o) => o.dataAplicacao > inicio && o.dataAplicacao <= fim);
  const resgates = ops
    .filter((o) => {
      const f = dataFim(o);
      return f !== null && f > inicio && f <= fim && o.dataAplicacao <= f;
    })
    .map((o) => resgateDe(o, p)!)
    .sort((a, b) => a.data.localeCompare(b.data));

  const saldoInicial = saldo(inicio);
  const saldoFinal = saldo(fim);
  const aplicacoes = novas.reduce((s, o) => s + o.principal, 0);
  const resgatesBrutos = resgates.reduce((s, r) => s + r.bruto, 0);
  const irrf = resgates.reduce((s, r) => s + r.ir, 0);
  const iof = resgates.reduce((s, r) => s + r.iof, 0);
  return {
    inicio,
    fim,
    saldoInicial,
    aplicacoes,
    resgatesBrutos,
    resgatesLiquidos: resgatesBrutos - irrf - iof,
    irrf,
    iof,
    rendimentos: saldoFinal - saldoInicial - aplicacoes + resgatesBrutos,
    saldoFinal,
    resgates,
    novasAplicacoes: novas,
  };
}

export interface MesEvolucao extends Movimentacao {
  cdiMes: number;
  rentabMes: number;
  pctCDI: number;
}

export function evolucaoMensal(ops: Operacao[], fimMeses: string[], p: Premissas): MesEvolucao[] {
  return fimMeses.map((fim) => {
    const inicio = addDays(`${fim.slice(0, 7)}-01`, -1);
    const m = movimentacao(ops, inicio, fim, p);
    const cdiMes = fatorCDI(inicio, fim, p) - 1;
    const base = m.saldoInicial + 0.5 * (m.aplicacoes - m.resgatesBrutos);
    const rentabMes = base > 0 ? m.rendimentos / base : 0;
    return { ...m, cdiMes, rentabMes, pctCDI: cdiMes > 0 ? rentabMes / cdiMes : 0 };
  });
}

/** % do CDI acumulado de uma série mensal: Σ rendimentos / Σ (capital médio × CDI do mês) */
export function pctCDIEvolucao(meses: MesEvolucao[]): number {
  const bench = meses.reduce((s, m) => s + m.cdiMes * (m.saldoInicial + 0.5 * (m.aplicacoes - m.resgatesBrutos)), 0);
  return bench > 0 ? meses.reduce((s, m) => s + m.rendimentos, 0) / bench : 0;
}

// ---------------------------------------------------------------------------
// Rentabilidade (R03)
// ---------------------------------------------------------------------------

export interface RentabOp {
  op: Operacao;
  status: "Ativa" | "Liquidada";
  inicio: string;
  fim: string;
  dias: number;
  base: number;
  rendimento: number;
  iof: number;
  ir: number;
  rendLiquido: number;
  rentabBruta: number;
  rentabLiquida: number;
  cdiPeriodo: number;
  pctCDIBruto: number;
  pctCDILiquido: number;
  ipcaPeriodo: number;
  rentabReal: number;
}

export function rentabilidade(ops: Operacao[], inicio: string, fim: string, p: Premissas): RentabOp[] {
  return ops
    .filter((o) => {
      const f = dataFim(o);
      return o.dataAplicacao <= fim && (f === null || f > inicio);
    })
    .map((op) => {
      const f = dataFim(op);
      const s = op.dataAplicacao > inicio ? op.dataAplicacao : inicio;
      const e = f !== null && f < fim ? f : fim;
      const base = valorBruto(op, s, p);
      const rendimento = valorBruto(op, e, p) - base;
      const diasTotais = diffDays(op.dataAplicacao, e);
      const iof = rendimento * aliquotaIOF(diasTotais);
      const ir = (rendimento - iof) * aliquotaIR(diasTotais, op.regimeIR);
      const rendLiquido = rendimento - iof - ir;
      const cdiPeriodo = fatorCDI(s, e, p) - 1;
      const dias = diffDays(s, e);
      const ipcaPeriodo = Math.pow(1 + p.ipca12m, dias / 365) - 1;
      const rentabBruta = base > 0 ? rendimento / base : 0;
      const rentabLiquida = base > 0 ? rendLiquido / base : 0;
      return {
        op,
        status: f !== null && f <= fim ? "Liquidada" : "Ativa",
        inicio: s,
        fim: e,
        dias,
        base,
        rendimento,
        iof,
        ir,
        rendLiquido,
        rentabBruta,
        rentabLiquida,
        cdiPeriodo,
        pctCDIBruto: cdiPeriodo > 0 ? rentabBruta / cdiPeriodo : 0,
        pctCDILiquido: cdiPeriodo > 0 ? rentabLiquida / cdiPeriodo : 0,
        ipcaPeriodo,
        rentabReal: (1 + rentabLiquida) / (1 + ipcaPeriodo) - 1,
      } satisfies RentabOp;
    });
}

export interface RentabCarteira {
  base: number;
  rendimento: number;
  iof: number;
  ir: number;
  rendLiquido: number;
  rentabBruta: number;
  rentabLiquida: number;
  cdiPeriodo: number;
  pctCDIBruto: number;
  pctCDILiquido: number;
  ipcaPeriodo: number;
  rentabReal: number;
}

export function consolidarRentabilidade(linhas: RentabOp[], inicio: string, fim: string, p: Premissas): RentabCarteira {
  const diasPeriodo = Math.max(1, diffDays(inicio, fim));
  const sum = (fn: (r: RentabOp) => number) => linhas.reduce((s, r) => s + fn(r), 0);
  const capital = sum((r) => r.base * (r.dias / diasPeriodo));
  const benchmark = sum((r) => r.base * r.cdiPeriodo);
  const rendimento = sum((r) => r.rendimento);
  const rendLiquido = sum((r) => r.rendLiquido);
  const cdiPeriodo = fatorCDI(inicio, fim, p) - 1;
  const ipcaPeriodo = Math.pow(1 + p.ipca12m, diasPeriodo / 365) - 1;
  const rentabBruta = capital > 0 ? rendimento / capital : 0;
  const rentabLiquida = capital > 0 ? rendLiquido / capital : 0;
  return {
    base: sum((r) => r.base),
    rendimento,
    iof: sum((r) => r.iof),
    ir: sum((r) => r.ir),
    rendLiquido,
    rentabBruta,
    rentabLiquida,
    cdiPeriodo,
    pctCDIBruto: benchmark > 0 ? rendimento / benchmark : 0,
    pctCDILiquido: benchmark > 0 ? rendLiquido / benchmark : 0,
    ipcaPeriodo,
    rentabReal: (1 + rentabLiquida) / (1 + ipcaPeriodo) - 1,
  };
}

// ---------------------------------------------------------------------------
// Eficiência fiscal (R04)
// ---------------------------------------------------------------------------

export type Recomendacao = "Evitar resgate (IOF)" | "Aguardar próxima faixa" | "Faixa mínima atingida" | "Sem restrição fiscal" | "Alíquota fixa";

export interface AnaliseFiscal {
  pos: Posicao;
  proxima: ProximaFaixa | null;
  diasAteProxima: number | null;
  dataProxima: string | null;
  venceAntes: boolean;
  irHoje: number;
  economiaIR: number; // (alíquota atual − próxima) × rendimento já apropriado
  rendimentoAdicional: number; // rendimento líquido extra até a próxima faixa
  recomendacao: Recomendacao;
}

export function analiseFiscal(pos: Posicao, p: Premissas): AnaliseFiscal {
  const { op } = pos;
  const proxima = proximaFaixaIR(pos.diasCorridos, op.regimeIR);
  const diasAteProxima = proxima ? proxima.aPartirDe - pos.diasCorridos : null;
  const dataProxima = proxima ? addDays(op.dataAplicacao, proxima.aPartirDe) : null;
  const venceAntes = !!(dataProxima && op.dataVencimento && op.dataVencimento < dataProxima);
  const irHoje = pos.ir;
  let economiaIR = 0;
  let rendimentoAdicional = 0;
  if (proxima && dataProxima && !venceAntes) {
    economiaIR = (pos.aliqIR - proxima.aliquota) * (pos.rendimento - pos.iof);
    const futuro = op.principal * fatorOperacao(op, dataProxima, p) - op.principal;
    rendimentoAdicional = futuro * (1 - proxima.aliquota) - (pos.rendimento - pos.iof - pos.ir);
  }
  let recomendacao: Recomendacao;
  if (pos.diasCorridos < 30) recomendacao = "Evitar resgate (IOF)";
  else if (op.regimeIR !== "Regressivo") recomendacao = "Alíquota fixa";
  else if (!proxima) recomendacao = "Faixa mínima atingida";
  else if (!venceAntes && diasAteProxima !== null && diasAteProxima <= 45) recomendacao = "Aguardar próxima faixa";
  else recomendacao = "Sem restrição fiscal";
  return { pos, proxima, diasAteProxima, dataProxima, venceAntes, irHoje, economiaIR, rendimentoAdicional, recomendacao };
}

/** Simulação de carga tributária por prazo (dias corridos 1..maxDias) para uma aplicação em % do CDI */
export function simularCargaTributaria(pctCDI: number, cdi: number, maxDias: number) {
  const pontos: { dias: number; aliqIR: number; aliqIOF: number; carga: number; pctCDILiquido: number }[] = [];
  const diario = Math.pow(1 + cdi, 1 / 365) - 1;
  for (let dias = 1; dias <= maxDias; dias++) {
    const bruto = Math.pow(1 + diario * pctCDI, dias) - 1;
    const aIOF = aliquotaIOF(dias);
    const aIR = aliquotaIR(dias, "Regressivo");
    const iof = bruto * aIOF;
    const ir = (bruto - iof) * aIR;
    const liquido = bruto - iof - ir;
    const cdiBruto = Math.pow(1 + diario, dias) - 1;
    pontos.push({
      dias,
      aliqIR: aIR,
      aliqIOF: aIOF,
      carga: bruto > 0 ? (iof + ir) / bruto : 0,
      pctCDILiquido: cdiBruto > 0 ? liquido / cdiBruto : 0,
    });
  }
  return pontos;
}
