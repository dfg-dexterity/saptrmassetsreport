import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";

export function R09Fundos() {
  return (
    <ReportPage relatorio={relatorioPorId("r09")}>
      <div />
    </ReportPage>
  );
}
