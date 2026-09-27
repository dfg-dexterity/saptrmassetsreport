import clsx from "clsx";
import type { ReactNode } from "react";
import type { ValueState } from "./ObjectStatus";

/** Cor do número por estado (tema Dexterity): ok em cerceta, atenção em âmbar, fora do limite em vermelho */
const COR: Record<ValueState, string> = {
  positive: "#00b3ac",
  critical: "#ffa436",
  negative: "#e4806c",
  information: "#d8d2c6",
  neutral: "#f7f3e7",
};

/** KPI do cabeçalho do relatório no padrão .dx-stat: rótulo mono, número em Barlow Condensed, detalhe abaixo */
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
      <div className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-label whitespace-nowrap">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-1.5">
        <span className="font-display text-[2rem] leading-[0.9] font-semibold tabular whitespace-nowrap" style={{ color: COR[state] }}>
          {value}
        </span>
        {unit && <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-label">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-label mt-1 whitespace-nowrap">{sub}</div>}
    </div>
  );
}

/** Barra de progresso fina, sem cantos (trilho em surface-2, marcador do limite em creme) */
export function MicroBar({
  value,
  max = 1,
  color = "#009994",
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
    <div className={clsx("relative h-1.5 bg-surface-2", className)}>
      <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, backgroundColor: color }} />
      {marker !== undefined && (
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-text" style={{ left: `${Math.min(100, (marker / max) * 100)}%` }} title="Limite" />
      )}
    </div>
  );
}

/**
 * Paleta categórica do tema escuro (validada sobre #242424: faixa de luminosidade, croma, separação para daltonismo
 * entre vizinhos e contraste ≥ 3:1). Use as posições em ordem, sem pular: a ordem é a que foi validada.
 */
export const CHART_COLORS = [
  "#009994",
  "#c97d24",
  "#a462a6",
  "#5e9454",
  "#4f8fd1",
  "#c9668f",
  "#a38a3c",
  "#8a7fd6",
  "#cf7a5c",
  "#1fa2c0",
  "#8f9c3e",
];

/**
 * Cores semânticas de gráficos: ok/alta em cerceta, atenção/baixa em âmbar, vermelho só para limite excedido.
 * `up`/`down` seguem o ticker da marca (entrada/saída, alta/queda) – nunca verde e vermelho.
 */
export const CHART_SEMANTIC = {
  good: "#009994",
  critical: "#ffa436",
  bad: "#d9563e",
  neutral: "#908c85",
  up: "#009994",
  down: "#ffa436",
};

/** Eixos em IBM Plex Mono, no cinza-areia do texto secundário */
export const AXIS_STYLE = { fontSize: 11, fill: "#a5a099", fontFamily: "IBM Plex Mono, ui-monospace, monospace" };

/** Grade e linhas de apoio dos gráficos: o filete da marca sobre a superfície do cartão */
export const GRID_STROKE = "#3f3f3d";
