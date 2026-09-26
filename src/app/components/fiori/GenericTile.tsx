import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ValueState } from "./ObjectStatus";

const COR: Record<ValueState, string> = {
  positive: "#256f3a",
  critical: "#b44f00",
  negative: "#aa0808",
  information: "#0070f2",
  neutral: "#1d2d3e",
};

/** sap.m.GenericTile (Horizon): OneByOne 11rem × 11rem, TwoByOne 22,5rem × 11rem */
export function GenericTile({
  title,
  subtitle,
  icon: Icon,
  iconColor = "#0070f2",
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
        "group relative text-left bg-white rounded-[var(--radius-tile)] shadow-fiori hover:shadow-fiori-lg transition-shadow p-4 flex flex-col",
        "h-44 shrink-0",
        wide ? "w-full sm:w-[22.5rem]" : "w-[calc(50%-0.375rem)] sm:w-44",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-text leading-snug line-clamp-2 group-hover:text-brand transition-colors">{title}</div>
          {subtitle && <div className="text-xs text-label leading-snug mt-0.5 truncate">{subtitle}</div>}
        </div>
        {badge}
      </div>

      <div className={clsx("mt-auto flex items-end gap-3", wide ? "justify-between" : "")}>
        <div className="min-w-0">
          <div className="flex items-end gap-1">
            {Icon && !wide && <Icon className="w-6 h-6 mb-1.5 mr-0.5 shrink-0" style={{ color: iconColor }} strokeWidth={1.75} />}
            {value !== undefined && (
              <span className="text-[2rem] leading-none font-light tabular whitespace-nowrap" style={{ color: COR[state] }}>
                {value}
              </span>
            )}
            {indicator &&
              (indicator === "up" ? (
                <ArrowUp className="w-4 h-4 mb-1" style={{ color: COR[state] }} />
              ) : (
                <ArrowDown className="w-4 h-4 mb-1" style={{ color: COR[state] }} />
              ))}
          </div>
          {unit && <div className="text-xs text-label mt-1 truncate">{unit}</div>}
        </div>
        {wide && chart && <div className="flex-1 h-16 min-w-0 max-w-[12rem]">{chart}</div>}
      </div>

      {footer && (
        <div
          className="text-xs mt-2 truncate"
          style={{ color: footerState ? COR[footerState] : "#556b82", fontWeight: footerState ? 600 : 400 }}
        >
          {footer}
        </div>
      )}
    </button>
  );
}
