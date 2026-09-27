import { Database, FileSpreadsheet, Scale } from "lucide-react";
import type { ProdutoInfo } from "../shared/context/ProdutoContext";
import { SECOES_CAPTACOES } from "./data/catalogo";

export const PRODUTO_CAPTACOES: ProdutoInfo = {
  id: "captacoes",
  nome: "Captações Financeiras",
  descricao: "Reporting Pack de Captações Financeiras (dívida) · SAP S/4HANA Treasury and Risk Management",
  secoes: SECOES_CAPTACOES,
  sobre: [
    {
      icone: FileSpreadsheet,
      cor: "#0070f2",
      texto:
        "Os relatórios reproduzem as abas de captações da planilha base (C00 a C06): carteira, movimentação, vencimentos, encargos, covenants, fechamento e nota explicativa.",
    },
    {
      icone: Scale,
      cor: "#df1278",
      texto:
        "Saldos pelo custo amortizado (CPC 48), classificação circulante × não circulante com reclassificação por covenant (CPC 26) e juros capitalizados em ativo qualificável (CPC 20).",
    },
    {
      icone: Database,
      cor: "#5d36ff",
      texto: "No ambiente produtivo os contratos vêm das CDS Views do SAP (IFINTRAN, IFINTRSMANAGE, IFINTRANSCNDN, CMATPROFILEQ), documentadas no Catálogo de CDS Views.",
    },
  ],
};
