import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioCaptacao } from "../data/catalogo";

export function KpisCaptacoes() {
  return (
    <ReportPage relatorio={relatorioCaptacao("kpis")}>
      <div />
    </ReportPage>
  );
}
