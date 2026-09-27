import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";

export function R08Tesouro() {
  return (
    <ReportPage relatorio={relatorioPorId("r08")}>
      <div />
    </ReportPage>
  );
}
