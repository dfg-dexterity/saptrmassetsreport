import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioCaptacao } from "../data/catalogo";

// Placeholder – implementação em andamento
export function C02Cronograma() {
  return <ReportPage relatorio={relatorioCaptacao("c02")}>{null}</ReportPage>;
}
