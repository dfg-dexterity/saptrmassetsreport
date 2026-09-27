import clsx from "clsx";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Popover simples ancorado ao gatilho (fecha ao clicar fora ou com Esc). No celular (< sm) abre como painel fixo
 * sob a shell bar, ocupando a largura da tela com margem de 8 px – nunca sai pelas bordas.
 */
export function Popover({
  trigger,
  children,
  align = "right",
  width = 320,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={clsx(
            "z-50 bg-surface border border-line-soft shadow-[0_30px_70px_rgba(0,0,0,0.45)] overflow-hidden",
            "fixed left-2 right-2 top-[calc(3.5rem+env(safe-area-inset-top,0px))]",
            "sm:absolute sm:top-full sm:mt-2 sm:w-[var(--popover-w)] sm:max-w-[calc(100vw-1rem)]",
            align === "right" ? "sm:left-auto sm:right-0" : "sm:right-auto sm:left-0",
          )}
          style={{ "--popover-w": `${width}px` } as CSSProperties}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
