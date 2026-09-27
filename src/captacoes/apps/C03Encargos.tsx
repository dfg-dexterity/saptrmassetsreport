import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioCaptacao } from "../data/catalogo";

// Placeholder – implementação em andamento
export function C03Encargos() {
  return <ReportPage relatorio={relatorioCaptacao("c03")}>{null}</ReportPage>;
}
