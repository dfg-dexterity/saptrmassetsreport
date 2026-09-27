import { Database, FileSpreadsheet, Target } from "lucide-react";
import type { ProdutoInfo } from "../shared/context/ProdutoContext";
import { SECOES } from "./data/catalogo";

export const PRODUTO_APLICACOES: ProdutoInfo = {
  id: "aplicacoes",
  nome: "Aplicações Financeiras",
  descricao: "Reporting Pack de Aplicações Financeiras · SAP S/4HANA Treasury and Risk Management",
  secoes: SECOES,
  sobre: [
    {
      icone: FileSpreadsheet,
      cor: "#0070f2",
      texto:
        "Os relatórios reproduzem as abas de aplicações da planilha base (Índice, Premissas, R01 a R07, nota explicativa e base técnica) e são recalculados para a data-base escolhida.",
    },
    {
      icone: Target,
      cor: "#049f9a",
      texto: "O benchmark de rentabilidade em % do CDI é cadastrado pelo usuário e compara cada aplicação no R01, R03 e R05.",
    },
    {
      icone: Database,
      cor: "#5d36ff",
      texto: "No ambiente produtivo os dados vêm das CDS Views do SAP (IFINTRAN, IFINTRSMANAGE, IFINTRANSCNDN), documentadas no Catálogo de CDS Views.",
    },
  ],
};
