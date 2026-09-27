import { ReportPage } from "../../shared/components/shell/ReportPage";
import { relatorioPorId } from "../data/catalogo";

export function CarteiraMestreApp() {
  return (
    <ReportPage relatorio={relatorioPorId("mestre")}>
      <div />
    </ReportPage>
  );
}
