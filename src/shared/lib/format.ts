const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Sinal de menos tipográfico (U+2212) em vez do hífen, em todos os formatadores */
function menos(s: string): string {
  return s.replace("-", "\u2212");
}

export function fmtBRL(v: number, decimals = false): string {
  if (!Number.isFinite(v)) return "—";
  return menos((decimals ? brl2 : brl).format(v));
}

/** Valor sem símbolo, sem casas decimais, negativos entre parênteses (padrão de nota explicativa). */
export function fmtNum(v: number, opts: { parens?: boolean; dash?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "—";
  const r = Math.round(v) || 0; // evita "-0"
  if (opts.dash && r === 0) return "–";
  if (opts.parens && r < 0) return `(${int.format(Math.abs(r))})`;
  return menos(int.format(r));
}

/** Valores em R$ mil (nota explicativa) */
export function fmtMil(v: number): string {
  return fmtNum(v / 1000, { parens: true, dash: true });
}

/** R$ 68,4 mi | R$ 950,2 mil */
export function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "\u2212" : "";
  // limiares pelo valor já arredondado (999.975 → "R$ 1 mi", não "R$ 1.000 mil")
  if (abs >= 1e9 - 5e6) return `${sign}R$\u00a0${(abs / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}\u00a0bi`;
  if (abs >= 1e6 - 50) return `${sign}R$\u00a0${(abs / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}\u00a0mi`;
  if (abs >= 1e3 - 0.5) return `${sign}R$\u00a0${(abs / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}\u00a0mil`;
  return `${sign}R$\u00a0${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

/** Número compacto sem moeda: 68,4 (mi) */
export function fmtMi(v: number, digits = 1): string {
  return (v / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Percentual a partir de fração (0.149 → 14,90%) */
/** Arredonda para `digits` casas eliminando o zero negativo ("-0,0") */
function semZeroNegativo(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f || 0;
}

export function fmtPct(frac: number, digits = 2): string {
  if (!Number.isFinite(frac)) return "—";
  return `${menos(semZeroNegativo(frac * 100, digits).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }))}%`;
}

/** Percentual do CDI a partir de fração (1.042 → 104,2% CDI) */
export function fmtPctCDI(frac: number, digits = 1): string {
  if (!Number.isFinite(frac)) return "—";
  return `${(frac * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}% CDI`;
}

export function fmtX(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${menos(semZeroNegativo(v, digits).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }))}x`;
}

export function fmtInt(v: number): string {
  return menos(int.format(v));
}

export function fmtDec(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  return menos(semZeroNegativo(v, digits).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
}
