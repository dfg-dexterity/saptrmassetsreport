import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

type Design = "information" | "positive" | "critical" | "negative";

const STYLE: Record<Design, { box: string; icon: typeof Info; iconColor: string }> = {
  information: { box: "bg-info-bg border-[#0070f2]/30", icon: Info, iconColor: "text-brand" },
  positive: { box: "bg-positive-bg border-[#30914c]/40", icon: CheckCircle2, iconColor: "text-positive" },
  critical: { box: "bg-critical-bg border-[#e76500]/40", icon: AlertTriangle, iconColor: "text-critical-strong" },
  negative: { box: "bg-negative-bg border-[#f53232]/40", icon: XCircle, iconColor: "text-negative" },
};

/** sap.m.MessageStrip */
export function MessageStrip({ design = "information", children, className }: { design?: Design; children: ReactNode; className?: string }) {
  const s = STYLE[design];
  const Icon = s.icon;
  return (
    <div className={clsx("flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] text-text", s.box, className)}>
      <Icon className={clsx("w-4 h-4 mt-px shrink-0", s.iconColor)} />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  );
}
