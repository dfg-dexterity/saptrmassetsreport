import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "emphasized" | "default" | "transparent" | "positive" | "negative";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  size?: "md" | "sm";
}

/**
 * Botão no padrão .dx-btn: Barlow Condensed em caixa alta, cantos vivos. O principal (cerceta, texto grafite) inverte
 * no hover – fundo some e o texto fica cerceta –, como no site; os demais são contornados por filete.
 */
export function Button({ variant = "default", icon, size = "md", className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 border font-display font-semibold uppercase whitespace-nowrap",
        "transition-[background-color,color,border-color] duration-200 disabled:opacity-45 disabled:cursor-not-allowed",
        size === "md" ? "h-9 px-4 text-[15px] tracking-[0.06em]" : "h-8 px-3 text-[13.5px] tracking-[0.05em]",
        variant === "emphasized" && "bg-brand border-brand text-page enabled:hover:bg-transparent enabled:hover:text-link",
        variant === "default" && "bg-transparent border-line text-text enabled:hover:border-text",
        variant === "transparent" && "bg-transparent border-transparent text-link enabled:hover:text-text enabled:hover:bg-hover",
        variant === "positive" && "bg-transparent border-brand text-positive enabled:hover:bg-positive-bg",
        variant === "negative" && "bg-transparent border-negative-border text-negative enabled:hover:bg-negative-bg",
        !children && (size === "md" ? "w-9 px-0" : "w-8 px-0"),
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
