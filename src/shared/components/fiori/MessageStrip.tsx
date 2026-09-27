import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

type Design = "information" | "positive" | "critical" | "negative";

/** Filete lateral de 3px na cor do aviso (como .dx-realce / .dx-erro); o texto fica sempre no tom suave */
const STYLE: Record<Design, { rule: string; icon: typeof Info; iconColor: string }> = {
  information: { rule: "border-l-brand", icon: Info, iconColor: "text-link" },
  positive: { rule: "border-l-brand", icon: CheckCircle2, iconColor: "text-positive" },
  critical: { rule: "border-l-amarelo", icon: AlertTriangle, iconColor: "text-critical" },
  negative: { rule: "border-l-negative-border", icon: XCircle, iconColor: "text-negative" },
};

/** Faixa de aviso no padrão .dx-realce */
export function MessageStrip({ design = "information", children, className }: { design?: Design; children: ReactNode; className?: string }) {
  const s = STYLE[design];
  const Icon = s.icon;
  return (
    <div className={clsx("flex items-start gap-2.5 bg-surface border border-line-soft border-l-[3px] px-3.5 py-2.5 text-[13px] text-suave", s.rule, className)}>
      <Icon className={clsx("w-4 h-4 mt-px shrink-0", s.iconColor)} />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  );
}
