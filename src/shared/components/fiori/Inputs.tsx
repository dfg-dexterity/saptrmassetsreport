import clsx from "clsx";
import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/** Campo de filtro (label acima, padrão Filter Bar Horizon) */
export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("flex flex-col gap-1 min-w-0", className)}>
      <span className="text-[13px] text-label">{label}</span>
      {children}
    </label>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={clsx("relative", className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full h-9 appearance-none rounded-[var(--radius-field)] border border-field bg-white pl-2.5 pr-8 text-sm text-text hover:bg-[#f7f9fb] focus:outline-none focus:border-brand focus:shadow-[inset_0_-1px_0_var(--color-brand)] cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-link" />
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Pesquisar",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={clsx("relative", className)}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 rounded-[var(--radius-field)] border border-field bg-white pl-2.5 pr-9 text-sm text-text placeholder:text-[#556b82]/80 placeholder:italic focus:outline-none focus:border-brand focus:shadow-[inset_0_-1px_0_var(--color-brand)]"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-label hover:bg-hover"
          aria-label="Limpar pesquisa"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ) : (
        <Search className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-label" />
      )}
    </div>
  );
}

/** Texto digitado → número: aceita vírgula ou ponto decimal ("102,5", "102.5", "1.000,50"); NaN se vazio/inválido */
export function lerNumero(texto: string): number {
  let t = texto.trim().replace(/\s/g, "");
  if (!t) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

/** Número → texto do campo (vírgula decimal pt-BR, sem separador de milhar) */
function formatarNumero(v: number): string {
  if (!Number.isFinite(v)) return "";
  return String(Math.round(v * 1e8) / 1e8).replace(".", ",");
}

/** Casas decimais do passo (evita 0,30000000000000004 nas setas) */
function casasDoPasso(step: number): number {
  const s = String(step);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

/**
 * Campo numérico (sap.m.Input type Number): texto livre em estado local, aceita vírgula ou ponto, propaga o número
 * sempre que o texto é válido e reformata ao perder o foco. Setas ↑/↓ somam/subtraem `step` (limitado a min/max).
 * Com `allowEmpty`, o campo vazio propaga NaN (a validação do formulário decide); sem ele, volta ao último valor.
 */
export function NumberInput({
  value,
  onChange,
  suffix,
  step = 0.01,
  min,
  max,
  className,
  ariaLabel,
  allowEmpty,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  ariaLabel?: string;
  allowEmpty?: boolean;
  id?: string;
}) {
  const [texto, setTexto] = useState(() => formatarNumero(value));

  // Valor alterado por fora (ex.: outro controle) → atualiza o texto, sem atropelar o que está sendo digitado
  useEffect(() => {
    setTexto((t) => {
      const atual = lerNumero(t);
      if (Object.is(atual, value) || atual === value || (Number.isNaN(atual) && Number.isNaN(value))) return t;
      return formatarNumero(value);
    });
  }, [value]);

  const alterar = (t: string) => {
    setTexto(t);
    const v = lerNumero(t);
    if (Number.isFinite(v)) onChange(v);
    else if (allowEmpty && !t.trim()) onChange(NaN);
  };

  const passo = (dir: 1 | -1) => {
    const base = Number.isFinite(lerNumero(texto)) ? lerNumero(texto) : Number.isFinite(value) ? value : (min ?? 0);
    const casas = casasDoPasso(step);
    let v = Number((base + dir * step).toFixed(casas));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setTexto(formatarNumero(v));
    onChange(v);
  };

  return (
    <div className={clsx("relative", className)}>
      <input
        id={id}
        aria-label={ariaLabel}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={texto}
        onChange={(e) => alterar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            passo(e.key === "ArrowUp" ? 1 : -1);
          }
        }}
        onBlur={() => {
          const v = lerNumero(texto);
          if (Number.isFinite(v)) setTexto(formatarNumero(v));
          else if (allowEmpty && !texto.trim()) setTexto("");
          else setTexto(formatarNumero(value));
        }}
        className="w-full h-9 rounded-[var(--radius-field)] border border-field bg-white pl-2.5 pr-12 text-sm text-right tabular text-text focus:outline-none focus:border-brand focus:shadow-[inset_0_-1px_0_var(--color-brand)]"
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-label">{suffix}</span>
      )}
    </div>
  );
}

/** sap.m.SegmentedButton */
export function SegmentedButton<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; icon?: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={clsx("inline-flex rounded-[var(--radius-button)] border border-[#bcc3ca] bg-white p-0.5", className)} role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            "inline-flex items-center gap-1.5 h-7 px-3 text-[13px] font-semibold rounded-md transition-colors whitespace-nowrap",
            value === it.value ? "bg-[#ebf8ff] text-[#0057d2] shadow-[inset_0_0_0_1px_#0070f2]" : "text-link hover:bg-hover",
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** sap.m.IconTabBar (modo texto) */
export function TabBar<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; count?: number | string }[];
}) {
  return (
    <div className="flex gap-1 overflow-x-auto fiori-scroll -mb-px" role="tablist">
      {items.map((it) => {
        const ativo = value === it.value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => onChange(it.value)}
            className={clsx(
              "relative px-3 pt-2.5 pb-3 text-sm font-semibold whitespace-nowrap transition-colors",
              ativo ? "text-brand" : "text-text hover:text-brand",
            )}
          >
            {it.label}
            {it.count !== undefined && <span className="ml-1.5 text-label font-normal">({it.count})</span>}
            <span
              className={clsx(
                "absolute left-2 right-2 bottom-0 h-[3px] rounded-t-full transition-colors",
                ativo ? "bg-brand" : "bg-transparent",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
