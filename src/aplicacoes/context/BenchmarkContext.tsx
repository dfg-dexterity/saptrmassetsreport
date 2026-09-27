import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BENCHMARKS_PADRAO, type Benchmark } from "../data/benchmark";

const CHAVE = "dxt-aplicacoes-benchmarks-v1";

interface Ctx {
  cadastro: Benchmark[];
  salvar: (b: Benchmark) => void;
  remover: (id: string) => void;
  restaurar: () => void;
  /** substitui a lista inteira (desfazer exclusão / restauração) */
  substituir: (lista: Benchmark[]) => void;
  alterado: boolean;
}

const BenchmarkContext = createContext<Ctx | null>(null);

function carregar(): Benchmark[] {
  try {
    const raw = window.localStorage.getItem(CHAVE);
    if (!raw) return BENCHMARKS_PADRAO;
    const lista = JSON.parse(raw) as Benchmark[];
    return Array.isArray(lista) && lista.every((b) => typeof b.pctCDI === "number" && b.id) ? lista : BENCHMARKS_PADRAO;
  } catch {
    return BENCHMARKS_PADRAO;
  }
}

/** Cadastro de benchmarks em % do CDI (salvo neste navegador) */
export function BenchmarkProvider({ children }: { children: ReactNode }) {
  const [cadastro, setCadastro] = useState<Benchmark[]>(carregar);

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAVE, JSON.stringify(cadastro));
    } catch {
      /* armazenamento indisponível – segue em memória */
    }
  }, [cadastro]);

  const salvar = useCallback((b: Benchmark) => {
    setCadastro((lista) => (lista.some((x) => x.id === b.id) ? lista.map((x) => (x.id === b.id ? b : x)) : [...lista, b]));
  }, []);
  const remover = useCallback((id: string) => setCadastro((lista) => lista.filter((x) => x.id !== id)), []);
  const restaurar = useCallback(() => setCadastro(BENCHMARKS_PADRAO), []);
  const substituir = useCallback((lista: Benchmark[]) => setCadastro(lista), []);
  const alterado = useMemo(() => JSON.stringify(cadastro) !== JSON.stringify(BENCHMARKS_PADRAO), [cadastro]);

  const value = useMemo(
    () => ({ cadastro, salvar, remover, restaurar, substituir, alterado }),
    [cadastro, salvar, remover, restaurar, substituir, alterado],
  );
  return <BenchmarkContext.Provider value={value}>{children}</BenchmarkContext.Provider>;
}

export function useBenchmarks(): Ctx {
  const ctx = useContext(BenchmarkContext);
  if (!ctx) throw new Error("useBenchmarks fora do BenchmarkProvider");
  return ctx;
}
