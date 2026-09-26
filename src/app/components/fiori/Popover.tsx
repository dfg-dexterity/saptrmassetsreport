import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Popover simples ancorado ao gatilho (fecha ao clicar fora ou com Esc) */
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
            "absolute top-full mt-2 z-50 bg-white rounded-[var(--radius-card)] shadow-fiori-lg border border-line-soft overflow-hidden max-w-[calc(100vw-1rem)]",
            align === "right" ? "right-0" : "left-0",
          )}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
