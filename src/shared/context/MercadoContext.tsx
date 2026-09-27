import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DATA_BASE_PADRAO, premissasNaDataBase, type PremissasMercado } from "../data/mercado";
import { lastMonthEnds } from "../lib/dates";

/** Datas-base disponíveis na demo (fins de mês com dados de mercado importados do SAP) */
export const DATAS_BASE = lastMonthEnds(DATA_BASE_PADRAO, 6).reverse();

interface Ctx {
  /** Premissas gerais importadas do SAP, vigentes na data-base selecionada */
  premissas: PremissasMercado;
  definirDataBase: (data: string) => void;
}

const MercadoContext = createContext<Ctx | null>(null);

function carregar(chave: string): string {
  try {
    const salvo = window.localStorage.getItem(chave);
    return salvo && DATAS_BASE.includes(salvo) ? salvo : DATA_BASE_PADRAO;
  } catch {
    return DATA_BASE_PADRAO;
  }
}

/** Data-base selecionada (lembrada neste navegador) e premissas gerais correspondentes */
export function MercadoProvider({ chave, children }: { chave: string; children: ReactNode }) {
  const [dataBase, setDataBase] = useState(() => carregar(chave));

  useEffect(() => {
    try {
      window.localStorage.setItem(chave, dataBase);
    } catch {
      /* armazenamento indisponível – segue em memória */
    }
  }, [chave, dataBase]);

  const definirDataBase = useCallback((d: string) => setDataBase(d), []);
  const premissas = useMemo(() => premissasNaDataBase(dataBase), [dataBase]);
  const value = useMemo(() => ({ premissas, definirDataBase }), [premissas, definirDataBase]);
  return <MercadoContext.Provider value={value}>{children}</MercadoContext.Provider>;
}

export function usePremissas(): Ctx {
  const ctx = useContext(MercadoContext);
  if (!ctx) throw new Error("usePremissas fora do MercadoProvider");
  return ctx;
}
