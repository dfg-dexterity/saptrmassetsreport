import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";

export function KpisAplicacoes() {
  return (
    <ReportPage relatorio={relatorioPorId("kpis")}>
      <div />
    </ReportPage>
  );
}
