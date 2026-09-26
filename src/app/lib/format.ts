const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export function fmtBRL(v: number, decimals = false): string {
  if (!Number.isFinite(v)) return "—";
  return (decimals ? brl2 : brl).format(v);
}

/** Valor sem símbolo, sem casas decimais, negativos entre parênteses (padrão de nota explicativa). */
export function fmtNum(v: number, opts: { parens?: boolean; dash?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "—";
  const r = Math.round(v);
  if (opts.dash && r === 0) return "–";
  if (opts.parens && r < 0) return `(${int.format(Math.abs(r))})`;
  return int.format(r);
}

/** Valores em R$ mil (nota explicativa) */
export function fmtMil(v: number): string {
  return fmtNum(v / 1000, { parens: true, dash: true });
}

/** R$ 68,4 mi | R$ 950,2 mil */
export function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}R$ ${(abs / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} bi`;
  if (abs >= 1e6) return `${sign}R$ ${(abs / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1e3) return `${sign}R$ ${(abs / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `${sign}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

/** Número compacto sem moeda: 68,4 (mi) */
export function fmtMi(v: number, digits = 1): string {
  return (v / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Percentual a partir de fração (0.149 → 14,90%) */
export function fmtPct(frac: number, digits = 2): string {
  if (!Number.isFinite(frac)) return "—";
  return `${(frac * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** Percentual do CDI a partir de fração (1.042 → 104,2% CDI) */
export function fmtPctCDI(frac: number, digits = 1): string {
  if (!Number.isFinite(frac)) return "—";
  return `${(frac * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}% CDI`;
}

export function fmtX(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}x`;
}

export function fmtInt(v: number): string {
  return int.format(v);
}

export function fmtDec(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
