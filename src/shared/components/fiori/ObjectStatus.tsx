import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, XCircle, MinusCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Semaforo } from "../../lib/semaforo";

export type ValueState = "positive" | "critical" | "negative" | "information" | "neutral";

const TEXT: Record<ValueState, string> = {
  positive: "text-positive",
  critical: "text-critical",
  negative: "text-negative",
  information: "text-info",
  neutral: "text-label",
};

/** Etiqueta (inverted): filete de 1px na cor do estado, texto no tom legível do mesmo estado, sem preenchimento */
const INVERTED: Record<ValueState, string> = {
  positive: "text-positive border-brand/70",
  critical: "text-critical border-amarelo/60",
  negative: "text-negative border-negative-border/80",
  information: "text-info border-line",
  neutral: "text-label border-line-soft",
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

/** Status semântico (texto + ícone); `inverted` vira etiqueta mono no padrão .dx-tag */
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
        "inline-flex items-center gap-1 whitespace-nowrap",
        inverted
          ? `border px-1.5 py-0.5 font-mono text-[10.5px] font-medium tracking-[0.06em] leading-tight ${INVERTED[state]}`
          : `text-[13px] font-semibold ${TEXT[state]}`,
        className,
      )}
    >
      {icon && <Icon className={inverted ? "w-3 h-3" : "w-3.5 h-3.5"} strokeWidth={2.25} />}
      {children}
    </span>
  );
}

/**
 * Etiqueta neutra no padrão .dx-tag (mono, filete de 1px). Com `color`, a cor entra como filete lateral de 3px – o
 * texto continua nos tons de texto, para não depender do contraste da cor da categoria.
 */
export function Tag({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.06em] leading-tight border border-line-soft text-suave whitespace-nowrap"
      style={color ? { borderLeftColor: color, borderLeftWidth: 3 } : undefined}
    >
      {children}
    </span>
  );
}
