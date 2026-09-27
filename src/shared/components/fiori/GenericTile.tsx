import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ValueState } from "./ObjectStatus";

/** Cor do número por estado (tema Dexterity) */
const COR: Record<ValueState, string> = {
  positive: "#00b3ac",
  critical: "#ffa436",
  negative: "#e4806c",
  information: "#d8d2c6",
  neutral: "#f7f3e7",
};

/**
 * Bloco do Launchpad (OneByOne 11rem × 11rem, TwoByOne 22,5rem × 11rem) no padrão de célula da grade de filetes:
 * título em Barlow Condensed, número grande, unidade e rodapé; no hover o filete e o título acendem em cerceta.
 */
export function GenericTile({
  title,
  subtitle,
  icon: Icon,
  iconColor = "#00b3ac",
  value,
  unit,
  state = "neutral",
  indicator,
  footer,
  footerState,
  wide,
  chart,
  onClick,
  badge,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  value?: ReactNode;
  unit?: string;
  state?: ValueState;
  indicator?: "up" | "down";
  footer?: ReactNode;
  footerState?: ValueState;
  wide?: boolean;
  chart?: ReactNode;
  onClick?: () => void;
  badge?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "group relative text-left bg-surface border border-line-soft hover:border-brand transition-colors p-4 flex flex-col",
        "h-44 shrink-0",
        wide ? "w-full sm:w-[22.5rem]" : "w-[calc(50%-0.375rem)] sm:w-44",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-[17px] font-semibold uppercase tracking-[0.03em] leading-[1.02] text-text line-clamp-2 group-hover:text-link transition-colors">
            {title}
          </div>
          {subtitle && <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-label leading-snug mt-1 truncate">{subtitle}</div>}
        </div>
        {badge}
      </div>

      <div className={clsx("mt-auto flex items-end gap-3", wide ? "justify-between" : "")}>
        <div className="min-w-0">
          <div className="flex items-end gap-1">
            {Icon && !wide && <Icon className="w-6 h-6 mb-1 mr-1 shrink-0" style={{ color: iconColor }} strokeWidth={1.75} />}
            {value !== undefined && (
              <span className="font-display text-[2.1rem] leading-[0.9] font-semibold tabular whitespace-nowrap" style={{ color: COR[state] }}>
                {value}
              </span>
            )}
            {indicator &&
              (indicator === "up" ? (
                <ArrowUp className="w-4 h-4 mb-0.5" style={{ color: COR[state] }} />
              ) : (
                <ArrowDown className="w-4 h-4 mb-0.5" style={{ color: COR[state] }} />
              ))}
          </div>
          {unit && (
            <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-label mt-1.5 truncate" title={unit}>
              {unit}
            </div>
          )}
        </div>
        {wide && chart && <div className="flex-1 h-16 min-w-0 max-w-[12rem]">{chart}</div>}
      </div>

      {footer && (
        <div
          className="text-xs mt-2 truncate"
          style={{ color: footerState ? COR[footerState] : "#a5a099", fontWeight: footerState ? 600 : 400 }}
          title={typeof footer === "string" ? footer : undefined}
        >
          {footer}
        </div>
      )}
    </button>
  );
}
