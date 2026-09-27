import { OPERACOES } from "../../aplicacoes/data/carteira";
import { posicoesEm } from "../../aplicacoes/lib/finance";
import { DADOS_CORPORATIVOS, GERACAO_CAIXA_ICSD, type DadosCorporativos } from "../../shared/data/corporativo";
import { premissasNaDataBase } from "../../shared/data/mercado";
import { addMonths } from "../../shared/lib/dates";
import type { Semaforo } from "../../shared/lib/semaforo";
import { CONTRATOS } from "../data/contratos";
import { COVENANTS_DIVIDA, WAIVERS, type CovenantDivida, type CovenantId, type Waiver } from "../data/covenants";
import { encargosDivida, posicoesDivida, servicoDivida, totalDivida } from "./divida";

/**
 * Indicadores corporativos e apuração de covenants (C04), com a regra do CPC 26 (itens 74–75): descumprimento
 * na data do balanço sem waiver obtido até essa data reclassifica o passivo não circulante para o circulante.
 */

export interface IndicadoresCorporativos extends DadosCorporativos {
  dividaBruta: number;
  aplicacoes: number;
  aplicacoesCirculantes: number;
  dividaLiquida: number;
  encargosLTM: number;
  capitalizadosLTM: number;
  dlEbitda: number;
  ebitdaDespFin: number;
  capitalizacao: number;
  dlImoveisPl: number;
  dlPl: number;
}

const cacheInd = new Map<string, IndicadoresCorporativos>();

/** Indicadores em um fim de trimestre presente em DADOS_CORPORATIVOS */
export function indicadoresEm(data: string): IndicadoresCorporativos {
  const hit = cacheInd.get(data);
  if (hit) return hit;
  const base = DADOS_CORPORATIVOS.find((d) => d.data === data);
  if (!base) throw new Error(`Sem dados corporativos em ${data}`);
  const p = premissasNaDataBase(data);
  const dividaBruta = totalDivida(posicoesDivida(CONTRATOS, data, p));
  const aplic = posicoesEm(OPERACOES, data, p);
  const aplicacoes = aplic.reduce((s, x) => s + x.valorContabil, 0);
  const aplicacoesCirculantes = aplic.filter((x) => x.circulante).reduce((s, x) => s + x.valorContabil, 0);
  const enc = encargosDivida(CONTRATOS, addMonths(data, -12), data, p);
  const encargosLTM = enc.reduce((s, e) => s + e.total, 0);
  const capitalizadosLTM = enc.reduce((s, e) => s + e.capitalizados, 0);
  const dividaLiquida = dividaBruta - base.caixa - aplicacoes;
  const ind: IndicadoresCorporativos = {
    ...base,
    dividaBruta,
    aplicacoes,
    aplicacoesCirculantes,
    dividaLiquida,
    encargosLTM,
    capitalizadosLTM,
    dlEbitda: dividaLiquida / base.ebitdaLTM,
    ebitdaDespFin: encargosLTM > 0 ? base.ebitdaLTM / encargosLTM : 0,
    capitalizacao: base.patrimonioLiquido / base.ativoTotal,
    dlImoveisPl: (dividaLiquida + base.imoveisAPagar) / base.patrimonioLiquido,
    dlPl: dividaLiquida / base.patrimonioLiquido,
  };
  cacheInd.set(data, ind);
  return ind;
}

export function trimestresAte(data: string): string[] {
  return DADOS_CORPORATIVOS.filter((d) => d.data <= data).map((d) => d.data);
}

export interface ICSDAno {
  ano: number;
  geracaoCaixa: number;
  servicoDivida: number;
  icsd: number;
}

export function icsdDoAno(ano: number): ICSDAno {
  const fim = `${ano}-12-31`;
  const p = premissasNaDataBase(fim);
  const servico = servicoDivida(CONTRATOS, `${ano - 1}-12-31`, fim, p);
  const geracao = GERACAO_CAIXA_ICSD[ano] ?? 0;
  return { ano, geracaoCaixa: geracao, servicoDivida: servico, icsd: servico > 0 ? geracao / servico : 0 };
}

/** Data da última apuração do covenant até a data-base */
export function ultimaApuracao(cov: CovenantDivida, dataBase: string): string | null {
  const datas = trimestresAte(dataBase).filter((d) => cov.periodicidade === "Trimestral" || d.endsWith("-12-31"));
  return datas.length ? datas[datas.length - 1] : null;
}

export function valorCovenant(id: CovenantId, dataApuracao: string): number {
  if (id === "icsd") return icsdDoAno(Number(dataApuracao.slice(0, 4))).icsd;
  const ind = indicadoresEm(dataApuracao);
  switch (id) {
    case "dlEbitda":
      return ind.dlEbitda;
    case "capitalizacao":
      return ind.capitalizacao;
    case "ebitdaDespFin":
      return ind.ebitdaDespFin;
    case "dlImoveisPl":
      return ind.dlImoveisPl;
  }
}

export function statusCovenant(cov: CovenantDivida, valor: number): Semaforo {
  if (cov.tipo === "max") return valor > cov.limite ? "excedido" : valor >= cov.alerta ? "atencao" : "ok";
  return valor < cov.limite ? "excedido" : valor <= cov.alerta ? "atencao" : "ok";
}

export interface ApuracaoCovenant {
  cov: CovenantDivida;
  dataApuracao: string | null;
  valor: number;
  status: Semaforo;
  folga: number; // positiva = dentro do limite
  waiver: Waiver | null;
  /** waiver obtido até a data-base */
  waiverVigente: boolean;
  /** passivo dos contratos vai para o circulante na data-base (CPC 26.74) */
  reclassifica: boolean;
  historico: { data: string; valor: number }[];
}

export function apurarCovenants(dataBase: string): ApuracaoCovenant[] {
  return COVENANTS_DIVIDA.map((cov) => {
    const dataApuracao = ultimaApuracao(cov, dataBase);
    const valor = dataApuracao ? valorCovenant(cov.id, dataApuracao) : NaN;
    const status = dataApuracao ? statusCovenant(cov, valor) : "ok";
    const folga = cov.tipo === "max" ? cov.limite - valor : valor - cov.limite;
    const waiver = WAIVERS.find((w) => w.covenantId === cov.id && w.apuracao === dataApuracao) ?? null;
    const waiverVigente = !!waiver && waiver.obtidoEm <= dataBase;
    const reclassifica = status === "excedido" && !waiverVigente;
    const historico = trimestresAte(dataBase)
      .filter((d) => cov.periodicidade === "Trimestral" || d.endsWith("-12-31"))
      .map((d) => ({ data: d, valor: valorCovenant(cov.id, d) }));
    return { cov, dataApuracao, valor, status, folga, waiver, waiverVigente, reclassifica, historico };
  });
}

/** Contratos cujo passivo não circulante é reclassificado para o circulante na data-base */
export function reclassificadosEm(dataBase: string): Set<string> {
  const ids = new Set<string>();
  for (const a of apurarCovenants(dataBase)) if (a.reclassifica) a.cov.contratos.forEach((c) => ids.add(c));
  return ids;
}
