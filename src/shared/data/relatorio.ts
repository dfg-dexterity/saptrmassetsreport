import type { LucideIcon } from "lucide-react";

/** Metadados de um relatório (espelho de uma linha da aba "Índice") */
export interface RelatorioBase {
  id: string;
  codigo: string;
  aba: string; // nome da aba na planilha
  titulo: string;
  tituloCurto: string;
  descricao: string;
  publico: string;
  periodicidade: string;
  norma: string;
  secao: string;
  rota: string;
  icone: LucideIcon;
  cor: string;
}

/** Mapeamento de uma coluna de relatório para um campo de CDS View */
export interface MapeamentoCampo {
  id: string;
  coluna: string;
  visao: string | null;
  campo: string | null;
  regra?: string;
}

export interface MapeamentoRelatorio {
  id: string;
  titulo: string;
  subtitulo: string;
  linhas: MapeamentoCampo[];
}
