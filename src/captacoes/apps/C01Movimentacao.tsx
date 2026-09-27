import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioCaptacao } from "../data/catalogo";

// Placeholder – implementação em andamento
export function C01Movimentacao() {
  return <ReportPage relatorio={relatorioCaptacao("c01")}>{null}</ReportPage>;
}
