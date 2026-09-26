/**
 * Datas como strings ISO (AAAA-MM-DD) convertidas para "número do dia" (dias desde 1970-01-01 em UTC),
 * evitando qualquer efeito de fuso horário nos cálculos financeiros.
 */

const MS_DIA = 86_400_000;

export function toDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DIA);
}

export function fromDay(day: number): string {
  const d = new Date(day * MS_DIA);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function addDays(iso: string, n: number): string {
  return fromDay(toDay(iso) + n);
}

export function diffDays(from: string, to: string): number {
  return toDay(to) - toDay(from);
}

export function endOfMonth(year: number, month: number): string {
  // month: 1-12
  return fromDay(Math.round(Date.UTC(year, month, 0) / MS_DIA));
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function monthOf(iso: string): number {
  return Number(iso.slice(5, 7));
}

/** Últimos `n` fins de mês até (e incluindo) o mês de `iso`, em ordem cronológica. */
export function lastMonthEnds(iso: string, n: number): string[] {
  const y = yearOf(iso);
  const m = monthOf(iso);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i;
    out.push(endOfMonth(Math.floor(total / 12), (total % 12) + 1));
  }
  return out;
}

export function previousMonthEnd(iso: string): string {
  return fromDay(toDay(`${iso.slice(0, 7)}-01`) - 1);
}

export function previousYearEnd(iso: string): string {
  return `${yearOf(iso) - 1}-12-31`;
}

// ---------------------------------------------------------------------------
// Calendário BR (feriados nacionais – base ANBIMA para contagem de dias úteis)
// ---------------------------------------------------------------------------

function easter(year: number): number {
  // Algoritmo de Meeus/Jones/Butcher
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Math.round(Date.UTC(year, month - 1, day) / MS_DIA);
}

const holidayCache = new Map<number, Set<number>>();

function holidays(year: number): Set<number> {
  let set = holidayCache.get(year);
  if (set) return set;
  set = new Set<number>();
  const fixed = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];
  if (year >= 2024) fixed.push("11-20"); // Dia da Consciência Negra (Lei 14.759/2023)
  for (const md of fixed) set.add(toDay(`${year}-${md}`));
  const e = easter(year);
  set.add(e - 48); // Carnaval (segunda)
  set.add(e - 47); // Carnaval (terça)
  set.add(e - 2); // Sexta-feira Santa
  set.add(e + 60); // Corpus Christi
  holidayCache.set(year, set);
  return set;
}

export function isBusinessDay(day: number): boolean {
  const dow = (((day + 4) % 7) + 7) % 7; // 0 = domingo
  if (dow === 0 || dow === 6) return false;
  const year = new Date(day * MS_DIA).getUTCFullYear();
  return !holidays(year).has(day);
}

/** Dias úteis no intervalo [from, to) */
export function businessDays(from: string, to: string): number {
  const a = toDay(from);
  const b = toDay(to);
  let n = 0;
  for (let d = a; d < b; d++) if (isBusinessDay(d)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Formatação pt-BR
// ---------------------------------------------------------------------------

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function fmtMonthShort(iso: string): string {
  return `${MESES[monthOf(iso) - 1]}/${String(yearOf(iso)).slice(2)}`;
}

export function fmtMonthLong(iso: string): string {
  return `${MESES_LONGOS[monthOf(iso) - 1]} de ${yearOf(iso)}`;
}

export function fmtQuarter(iso: string): string {
  return `${Math.ceil(monthOf(iso) / 3)}T${String(yearOf(iso)).slice(2)}`;
}
