import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";

export function R11MoedaTipo() {
  return (
    <ReportPage relatorio={relatorioPorId("r11")}>
      <div />
    </ReportPage>
  );
}
