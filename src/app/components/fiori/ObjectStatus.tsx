import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, XCircle, MinusCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Semaforo } from "../../lib/indicadores";

export type ValueState = "positive" | "critical" | "negative" | "information" | "neutral";

const TEXT: Record<ValueState, string> = {
  positive: "text-positive",
  critical: "text-critical",
  negative: "text-negative",
  information: "text-info",
  neutral: "text-label",
};

const INVERTED: Record<ValueState, string> = {
  positive: "bg-positive-bg text-positive border-[#30914c]/40",
  critical: "bg-critical-bg text-critical border-[#e76500]/40",
  negative: "bg-negative-bg text-negative border-[#f53232]/40",
  information: "bg-info-bg text-[#0057d2] border-[#0070f2]/30",
  neutral: "bg-neutral-bg text-[#475e75] border-[#788fa6]/40",
};

const ICON: Record<ValueState, typeof Info> = {
  positive: CheckCircle2,
  critical: AlertTriangle,
  negative: XCircle,
  information: Info,
  neutral: MinusCircle,
};

export function semaforoState(s: Semaforo): ValueState {
  return s === "ok" ? "positive" : s === "atencao" ? "critical" : "negative";
}

/** sap.m.ObjectStatus – texto semântico, opcionalmente "inverted" (tag) */
export function ObjectStatus({
  state = "neutral",
  children,
  inverted,
  icon = true,
  className,
}: {
  state?: ValueState;
  children: ReactNode;
  inverted?: boolean;
  icon?: boolean;
  className?: string;
}) {
  const Icon = ICON[state];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 font-semibold whitespace-nowrap",
        inverted ? `rounded-md border px-1.5 py-0.5 text-xs ${INVERTED[state]}` : `text-[13px] ${TEXT[state]}`,
        className,
      )}
    >
      {icon && <Icon className={inverted ? "w-3 h-3" : "w-3.5 h-3.5"} strokeWidth={2.25} />}
      {children}
    </span>
  );
}

/** Pequena tag neutra (sap.m.Token/Tag) */
export function Tag({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold border whitespace-nowrap"
      style={
        color
          ? { color, borderColor: `${color}55`, backgroundColor: `${color}12` }
          : { color: "#475e75", borderColor: "#c5ccd3", backgroundColor: "#f5f6f7" }
      }
    >
      {children}
    </span>
  );
}
