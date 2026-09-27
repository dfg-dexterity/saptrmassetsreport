import { CdsCatalogo } from "../../shared/apps/CdsCatalogo";
import { MAPEAMENTOS_APLICACOES, relatorioPorId } from "../data/catalogo";

export function CdsAplicacoes() {
  return <CdsCatalogo relatorio={relatorioPorId("cds")} mapeamentos={MAPEAMENTOS_APLICACOES} />;
}
