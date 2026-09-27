import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioCaptacao } from "../data/catalogo";

// Placeholder – implementação em andamento
export function C00Carteira() {
  return <ReportPage relatorio={relatorioCaptacao("c00")}>{null}</ReportPage>;
}
