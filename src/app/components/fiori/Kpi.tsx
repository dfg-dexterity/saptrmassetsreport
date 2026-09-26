import clsx from "clsx";
import type { ReactNode } from "react";
import type { ValueState } from "./ObjectStatus";

const COR: Record<ValueState, string> = {
  positive: "#256f3a",
  critical: "#b44f00",
  negative: "#aa0808",
  information: "#0070f2",
  neutral: "#1d2d3e",
};

/** KPI do cabeçalho da Dynamic Page (Header KPI / Numeric Content) */
export function HeaderKpi({
  label,
  value,
  unit,
  state = "neutral",
  sub,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  state?: ValueState;
  sub?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-label whitespace-nowrap">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="text-[1.625rem] leading-tight font-light tabular whitespace-nowrap" style={{ color: COR[state] }}>
          {value}
        </span>
        {unit && <span className="text-sm text-label">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-label mt-0.5 whitespace-nowrap">{sub}</div>}
    </div>
  );
}

/** Barra de progresso fina (sap.m.ProgressIndicator compacto / micro chart) */
export function MicroBar({
  value,
  max = 1,
  color = "#0070f2",
  marker,
  className,
}: {
  value: number;
  max?: number;
  color?: string;
  marker?: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div className={clsx("relative h-1.5 rounded-full bg-[#e5e5e5]", className)}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      {marker !== undefined && (
        <div
          className="absolute -top-1 -bottom-1 w-0.5 bg-[#1d2d3e]"
          style={{ left: `${Math.min(100, (marker / max) * 100)}%` }}
          title="Limite"
        />
      )}
    </div>
  );
}

/** Paleta qualitativa de gráficos do SAP Horizon (sapChart_OrderedColor_1…11) */
export const CHART_COLORS = [
  "#168eff",
  "#c87b00",
  "#75980b",
  "#df1278",
  "#8b47d7",
  "#049f9a",
  "#0070f2",
  "#cc00dc",
  "#798c77",
  "#da6c6c",
  "#5d36ff",
];

/** Cores semânticas de gráficos (sapChart_Good/Critical/Bad/Neutral) */
export const CHART_SEMANTIC = {
  good: "#30914c",
  critical: "#e26300",
  bad: "#f53232",
  neutral: "#758ca4",
};

export const AXIS_STYLE = { fontSize: 12, fill: "#556b82", fontFamily: "72, Arial, sans-serif" };
