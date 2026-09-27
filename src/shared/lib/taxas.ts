import { CDI_MENSAL, PRIMEIRO_MES_CDI, type PremissasMercado } from "../data/mercado";
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

/** Chave de cache das premissas (mudam apenas com a data-base) */
export function chavePremissas(p: PremissasMercado): string {
  return `${p.dataBase}|${p.cdi}|${p.selic}|${p.ipca12m}|${p.tjlp}|${p.tlpReal}`;
}
