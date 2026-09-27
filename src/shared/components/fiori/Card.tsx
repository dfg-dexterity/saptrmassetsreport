import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Padding padrão do corpo do cartão, omitindo os eixos que `bodyClassName` já define (ex.: "px-0 pb-0" para tabelas
 * de borda a borda) – sem isso, a classe padrão prevaleceria na folha de estilos.
 */
function paddingPadrao(temCabecalho: boolean, extra?: string): string {
  const tokens = (extra ?? "").split(/\s+/).map((t) => t.replace(/!$/, "").replace(/^!/, "").replace(/^[a-z]+:/, ""));
  const define = (...prefixos: string[]) => tokens.some((t) => prefixos.some((pr) => t.startsWith(`${pr}-`)));
  const out: string[] = [];
  if (!define("p", "px")) out.push("px-4");
  if (!define("p", "py", "pb")) out.push("pb-4");
  if (!temCabecalho && !define("p", "py", "pt")) out.push("pt-4");
  return out.join(" ");
}

/** Cartão no padrão .dx-card: superfície grafite, filete de 1px, cantos vivos e título em Barlow Condensed */
export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  icon,
  status,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  icon?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <section className={clsx("bg-surface border border-line-soft print-flat", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5">
          <div className="flex items-start gap-2.5 min-w-0">
            {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
            <div className="min-w-0">
              {title && <h3 className="text-[19px] font-semibold tracking-[0.03em] leading-[1.05] text-text">{title}</h3>}
              {subtitle && <p className="text-[13px] text-label leading-snug mt-1">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {status}
            {actions}
          </div>
        </header>
      )}
      <div className={clsx(paddingPadrao(Boolean(title || actions), bodyClassName), bodyClassName)}>{children}</div>
    </section>
  );
}

/** Título de seção: Barlow Condensed em caixa alta seguido do filete da marca */
export function SectionTitle({ children, extra, id }: { children: ReactNode; extra?: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex items-center gap-3 mb-3 mt-1 scroll-mt-28">
      <h2 className="text-[22px] sm:text-[26px] font-semibold tracking-[0.01em] leading-[0.95] text-text min-w-0 sm:whitespace-nowrap">{children}</h2>
      <div className="flex-1 h-px bg-line-soft" />
      {extra}
    </div>
  );
}

/** Rótulo mono + valor (formulário de exibição) */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("min-w-0", className)}>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-label leading-tight">{label}</div>
      <div className="text-sm text-text font-medium leading-snug mt-1 truncate">{children}</div>
    </div>
  );
}
