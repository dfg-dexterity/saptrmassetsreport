import clsx from "clsx";
import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/** Campo de filtro no padrão .dx-field: rótulo mono em caixa alta acima do controle */
export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("flex flex-col gap-1.5 min-w-0", className)}>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-label">{label}</span>
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
        className="w-full h-9 appearance-none border border-line-soft bg-surface-3 pl-2.5 pr-8 text-sm text-text hover:border-line focus:border-brand focus-visible:outline-offset-2 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-label" />
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
        className="w-full h-9 border border-line-soft bg-surface-3 pl-2.5 pr-9 text-sm text-text placeholder:text-muted hover:border-line focus:border-brand focus-visible:outline-offset-2"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-label hover:text-text hover:bg-hover"
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
 * sempre que o texto é válido e reformata ao perder o foco. Setas ↑/↓ andam `step` na grade a partir de `min`, como o
 * input nativo (limitado a min/max).
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
      if (atual === value || (Number.isNaN(atual) && Number.isNaN(value))) return t;
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
    // Como no input nativo: valor fora da grade (min + k × step) vai para o próximo ponto da grade na direção da seta
    const origem = min ?? 0;
    const casas = Math.max(casasDoPasso(step), casasDoPasso(origem));
    const k = (base - origem) / step;
    const n = Math.abs(k - Math.round(k)) < 1e-9 ? Math.round(k) + dir : dir > 0 ? Math.ceil(k) : Math.floor(k);
    let v = Number((origem + n * step).toFixed(casas));
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
        className="w-full h-9 border border-line-soft bg-surface-3 pl-2.5 pr-12 font-mono text-[13px] text-right tabular text-text hover:border-line focus:border-brand focus-visible:outline-offset-2"
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] text-label">{suffix}</span>
      )}
    </div>
  );
}

/** Alternância em grupo de .dx-chip: mono em caixa alta; o item ativo é preenchido de cerceta */
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
    <div className={clsx("inline-flex", className)} role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            "relative inline-flex items-center gap-1.5 h-8 px-3 -ml-px first:ml-0 border font-mono text-[11px] uppercase tracking-[0.1em] whitespace-nowrap transition-[background-color,color,border-color] duration-150",
            value === it.value
              ? "z-[1] bg-brand border-brand text-page"
              : "border-line-soft text-label hover:z-[1] hover:text-text hover:border-text",
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Abas em texto: Barlow Condensed em caixa alta, aba ativa em creme com filete cerceta */
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
              "relative px-3 pt-2.5 pb-3 font-display text-[16px] font-semibold uppercase tracking-[0.05em] whitespace-nowrap transition-colors",
              ativo ? "text-text" : "text-label hover:text-text",
            )}
          >
            {it.label}
            {it.count !== undefined && <span className="ml-1.5 font-mono text-[11px] font-normal tracking-normal text-label">({it.count})</span>}
            <span
              className={clsx(
                "absolute left-3 right-3 bottom-0 h-[2px] transition-colors",
                ativo ? "bg-brand" : "bg-transparent",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
