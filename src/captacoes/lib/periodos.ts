import { addDays, diffDays, fmtDate, fmtMonthLong, fmtMonthShort, fmtQuarter, lastMonthEnds, monthOf, previousYearEnd, yearOf } from "../../shared/lib/dates";

/** Períodos de apuração comuns ao C01 (movimentação) e ao C03 (encargos) */

export type Periodo = "mes" | "trimestre" | "exercicio" | "12m";

export const PERIODOS: { value: Periodo; label: string }[] = [
  { value: "mes", label: "Mês" },
  { value: "trimestre", label: "Trimestre" },
  { value: "exercicio", label: "Exercício" },
  { value: "12m", label: "12 meses" },
];

export interface PeriodoApuracao {
  /** data do saldo de abertura (fim do período anterior); os encargos correm do dia seguinte até a data-base */
  inicio: string;
  fim: string;
  dias: number;
  /** "1º trimestre de 2026", "Exercício de 2026 (jan a mar)" */
  descricao: string;
  /** "1T26", "mar/26" – KPIs */
  curto: string;
  /** "31/12/2025 a 31/03/2026 · 90 dias" – mesmo formato no C01 e no C03 */
  rotulo: string;
}

/**
 * Mês = mês da data-base; Trimestre = trimestre civil até a data-base; Exercício = desde 31/12 do ano anterior;
 * 12 meses = os 12 meses encerrados na data-base.
 */
export function periodoApuracao(periodo: Periodo, dataBase: string): PeriodoApuracao {
  const mes = monthOf(dataBase);
  const ano = yearOf(dataBase);
  const mesesNoTrimestre = ((mes - 1) % 3) + 1;
  const inicio =
    periodo === "mes"
      ? lastMonthEnds(dataBase, 2)[0]
      : periodo === "trimestre"
        ? lastMonthEnds(dataBase, mesesNoTrimestre + 1)[0]
        : periodo === "exercicio"
          ? previousYearEnd(dataBase)
          : lastMonthEnds(dataBase, 13)[0];
  const dias = diffDays(inicio, dataBase);
  const mesAbrev = fmtMonthShort(dataBase).slice(0, 3);
  const mesLongo = fmtMonthLong(dataBase);
  const [descricao, curto] =
    periodo === "mes"
      ? [mesLongo.charAt(0).toUpperCase() + mesLongo.slice(1), fmtMonthShort(dataBase)]
      : periodo === "trimestre"
        ? [`${Math.ceil(mes / 3)}º trimestre de ${ano}${mesesNoTrimestre < 3 ? ` (até ${mesAbrev})` : ""}`, fmtQuarter(dataBase)]
        : periodo === "exercicio"
          ? [mes === 12 ? `Exercício de ${ano}` : `Exercício de ${ano} (${mes === 1 ? "jan" : `jan a ${mesAbrev}`})`, `Exercício ${ano}`]
          : [`12 meses (${fmtMonthShort(addDays(inicio, 1))} a ${fmtMonthShort(dataBase)})`, "12 meses"];
  return { inicio, fim: dataBase, dias, descricao, curto, rotulo: `${fmtDate(inicio)} a ${fmtDate(dataBase)} · ${dias} dias` };
}
