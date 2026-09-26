import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "emphasized" | "default" | "transparent" | "positive" | "negative";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  size?: "md" | "sm";
}

/** Botão no padrão SAP Horizon (raio 0.5rem, 72 Semibold) */
export function Button({ variant = "default", icon, size = "md", className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-button)] font-semibold whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        size === "md" ? "h-9 px-3.5 text-sm" : "h-8 px-2.5 text-[13px]",
        variant === "emphasized" && "bg-brand text-white hover:bg-brand-hover active:bg-brand-active shadow-[0_0_0_1px_var(--color-brand)]",
        variant === "default" && "bg-white text-link border border-[#bcc3ca] hover:bg-[#eaecee] active:bg-[#dee2e5]",
        variant === "transparent" && "bg-transparent text-link hover:bg-[#eaecee] active:bg-[#dee2e5]",
        variant === "positive" && "bg-[#f5fae5] text-positive border border-[#30914c] hover:bg-[#ebf5cb]",
        variant === "negative" && "bg-[#ffeaf4] text-negative border border-[#f53232] hover:bg-[#fddfee]",
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
