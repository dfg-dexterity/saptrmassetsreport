import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioCaptacao } from "../data/catalogo";

// Placeholder – implementação em andamento
export function C05Fechamento() {
  return <ReportPage relatorio={relatorioCaptacao("c05")}>{null}</ReportPage>;
}
