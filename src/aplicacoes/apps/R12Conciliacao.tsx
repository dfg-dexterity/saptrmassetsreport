import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";

export function R12Conciliacao() {
  return (
    <ReportPage relatorio={relatorioPorId("r12")}>
      <div />
    </ReportPage>
  );
}
