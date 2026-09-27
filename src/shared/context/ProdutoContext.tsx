import type { LucideIcon } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";

export interface SecaoProduto {
  id: string;
  numero: number;
  titulo: string;
}

export interface Alerta {
  id: string;
  severidade: "negative" | "critical" | "information";
  titulo: string;
  descricao: string;
  rota: string;
}

export interface ItemSobre {
  icone: LucideIcon;
  cor: string;
  texto: ReactNode;
}

export interface ProdutoInfo {
  id: "aplicacoes" | "captacoes";
  /** Nome exibido na shell bar (ex.: "Aplicações Financeiras") */
  nome: string;
  /** Linha de apresentação no Launchpad */
  descricao: string;
  secoes: SecaoProduto[];
  sobre: ItemSobre[];
}

interface Ctx extends ProdutoInfo {
  alertas: Alerta[];
}

const ProdutoContext = createContext<Ctx | null>(null);

/** Identidade do produto (Aplicações × Captações) e alertas calculados para a data-base */
export function ProdutoProvider({
  info,
  usarAlertas,
  children,
}: {
  info: ProdutoInfo;
  usarAlertas: () => Alerta[];
  children: ReactNode;
}) {
  const alertas = usarAlertas();
  return <ProdutoContext.Provider value={{ ...info, alertas }}>{children}</ProdutoContext.Provider>;
}

export function useProduto(): Ctx {
  const ctx = useContext(ProdutoContext);
  if (!ctx) throw new Error("useProduto fora do ProdutoProvider");
  return ctx;
}
