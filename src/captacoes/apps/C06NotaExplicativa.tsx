import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioCaptacao } from "../data/catalogo";

// Placeholder – implementação em andamento
export function C06NotaExplicativa() {
  return <ReportPage relatorio={relatorioCaptacao("c06")}>{null}</ReportPage>;
}
