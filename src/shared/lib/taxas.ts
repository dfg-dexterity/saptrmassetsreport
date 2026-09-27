import { CDI_MENSAL, IPCA_12M_MENSAL, PRIMEIRO_MES_CDI, TJLP_MENSAL, TLP_REAL_MENSAL, valorDoMes, type PremissasMercado } from "../data/mercado";
import { fromDay } from "./dates";

/**
 * CDI a.a. vigente no dia (número do dia desde 1970-01-01): série histórica importada do SAP até o mês da data-base;
 * depois dela, o último CDI disponível (projeção com taxa constante).
 */
export function cdiAnual(day: number, p: PremissasMercado): number {
  const key = fromDay(day).slice(0, 7);
  if (key > p.dataBase.slice(0, 7)) return p.cdi;
  if (key < PRIMEIRO_MES_CDI) return CDI_MENSAL[PRIMEIRO_MES_CDI];
  return CDI_MENSAL[key] ?? p.cdi;
}

/** Selic a.a. vigente no dia (histórico = CDI + 0,10 p.p.; projeção = Selic da data-base) */
export function selicAnual(day: number, p: PremissasMercado): number {
  const key = fromDay(day).slice(0, 7);
  if (key > p.dataBase.slice(0, 7)) return p.selic;
  return cdiAnual(day, p) + 0.001;
}

/** Valor histórico do mês até a data-base; depois dela, o último dado disponível (valor das premissas) */
function historicoOuProjecao(serie: Record<string, number>, day: number, p: PremissasMercado, projecao: number): number {
  const key = fromDay(day).slice(0, 7);
  if (key > p.dataBase.slice(0, 7)) return projecao;
  return valorDoMes(serie, key);
}

/** IPCA 12 meses (taxa anual de correção) vigente no dia */
export function ipcaAnual(day: number, p: PremissasMercado): number {
  return historicoOuProjecao(IPCA_12M_MENSAL, day, p, p.ipca12m);
}

/** TJLP a.a. vigente no dia */
export function tjlpAnual(day: number, p: PremissasMercado): number {
  return historicoOuProjecao(TJLP_MENSAL, day, p, p.tjlp);
}

/** TLP real contratada: taxa do mês da contratação (fixa por toda a vida do contrato) */
export function tlpRealContratada(dataContratacao: string): number {
  return valorDoMes(TLP_REAL_MENSAL, dataContratacao.slice(0, 7));
}

/** Chave de cache das premissas (mudam apenas com a data-base) */
export function chavePremissas(p: PremissasMercado): string {
  return `${p.dataBase}|${p.cdi}|${p.selic}|${p.ipca12m}|${p.tjlp}|${p.tlpReal}`;
}
