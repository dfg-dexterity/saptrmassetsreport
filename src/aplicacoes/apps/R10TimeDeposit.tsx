import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";

export function R10TimeDeposit() {
  return (
    <ReportPage relatorio={relatorioPorId("r10")}>
      <div />
    </ReportPage>
  );
}
