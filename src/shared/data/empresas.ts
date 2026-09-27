/** Empresas do grupo no ambiente de teste (fictícias) */
export const EMPRESAS: Record<string, { nome: string; papel: "Controladora" | "Controlada" }> = {
  "1000": { nome: "Empresa ABC S.A.", papel: "Controladora" },
  "2000": { nome: "ABC Logística Ltda.", papel: "Controlada" },
  "3000": { nome: "ABC Energia S.A.", papel: "Controlada" },
};

export const EMPRESA_CONTROLADORA = "1000";

export type Escopo = "todas" | string;

export const ESCOPOS: { value: Escopo; label: string }[] = [
  { value: "todas", label: "Consolidado (todas as empresas)" },
  { value: "1000", label: "1000 – Empresa ABC S.A." },
  { value: "2000", label: "2000 – ABC Logística Ltda." },
  { value: "3000", label: "3000 – ABC Energia S.A." },
];
