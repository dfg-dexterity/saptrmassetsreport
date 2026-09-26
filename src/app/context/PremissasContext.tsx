import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PREMISSAS_PADRAO, type Premissas } from "../data/premissas";
import { lastMonthEnds } from "../lib/dates";

const STORAGE_KEY = "dxt-trm-reporting-premissas-v1";

/** Datas-base disponíveis na demo (fins de mês) */
export const DATAS_BASE = lastMonthEnds(PREMISSAS_PADRAO.dataBase, 6).reverse();

interface Ctx {
  premissas: Premissas;
  atualizar: (parcial: Partial<Premissas>) => void;
  restaurar: () => void;
  alterado: boolean;
}

const PremissasContext = createContext<Ctx | null>(null);

function carregar(): Premissas {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return PREMISSAS_PADRAO;
    const salvo = JSON.parse(raw) as Partial<Premissas>;
    const p = { ...PREMISSAS_PADRAO, ...salvo };
    if (!DATAS_BASE.includes(p.dataBase)) p.dataBase = PREMISSAS_PADRAO.dataBase;
    return p;
  } catch {
    return PREMISSAS_PADRAO;
  }
}

export function PremissasProvider({ children }: { children: ReactNode }) {
  const [premissas, setPremissas] = useState<Premissas>(carregar);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(premissas));
    } catch {
      /* armazenamento indisponível – segue em memória */
    }
  }, [premissas]);

  const atualizar = useCallback((parcial: Partial<Premissas>) => {
    setPremissas((p) => ({ ...p, ...parcial }));
  }, []);

  const restaurar = useCallback(() => setPremissas(PREMISSAS_PADRAO), []);

  const alterado = useMemo(
    () => (Object.keys(PREMISSAS_PADRAO) as (keyof Premissas)[]).some((k) => premissas[k] !== PREMISSAS_PADRAO[k]),
    [premissas],
  );

  const value = useMemo(() => ({ premissas, atualizar, restaurar, alterado }), [premissas, atualizar, restaurar, alterado]);
  return <PremissasContext.Provider value={value}>{children}</PremissasContext.Provider>;
}

export function usePremissas(): Ctx {
  const ctx = useContext(PremissasContext);
  if (!ctx) throw new Error("usePremissas fora do PremissasProvider");
  return ctx;
}
