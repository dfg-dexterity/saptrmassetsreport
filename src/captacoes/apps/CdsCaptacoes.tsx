import { CdsCatalogo } from "../../shared/apps/CdsCatalogo";
import { MAPEAMENTOS_CAPTACOES, relatorioCaptacao } from "../data/catalogo";

export function CdsCaptacoes() {
  return <CdsCatalogo relatorio={relatorioCaptacao("cds")} mapeamentos={MAPEAMENTOS_CAPTACOES} />;
}
