import type { Modalidade } from "./contratos";

/**
 * C05 – Parametrização do fechamento (ambiente de teste): contas contábeis do FI-GL, fontes de extrato,
 * etapas do checklist SAP e diferenças simuladas para a demonstração.
 */

export type GrupoContabil = "BNDES" | "CCB" | "Debêntures" | "CRA/CRI";

export function grupoContabil(m: Modalidade): GrupoContabil {
  if (m === "BNDES FINEM" || m === "BNDES FINAME") return "BNDES";
  if (m === "CCB") return "CCB";
  if (m === "CRA" || m === "CRI") return "CRA/CRI";
  return "Debêntures";
}

export type Rubrica = "principalCP" | "juros" | "custosCP" | "principalLP" | "custosLP";

export interface ContaContabil {
  conta: string;
  descricao: string;
  grupo: GrupoContabil;
  rubrica: Rubrica;
}

const RUBRICAS: { rubrica: Rubrica; prefixo: "2.1" | "2.2"; sufixo: string; rotulo: string }[] = [
  { rubrica: "principalCP", prefixo: "2.1", sufixo: "1", rotulo: "Principal – circulante" },
  { rubrica: "juros", prefixo: "2.1", sufixo: "2", rotulo: "Juros e encargos a pagar" },
  { rubrica: "custosCP", prefixo: "2.1", sufixo: "9", rotulo: "(−) Custos de transação a apropriar – circulante" },
  { rubrica: "principalLP", prefixo: "2.2", sufixo: "1", rotulo: "Principal – não circulante" },
  { rubrica: "custosLP", prefixo: "2.2", sufixo: "9", rotulo: "(−) Custos de transação a apropriar – não circulante" },
];

const GRUPOS: { grupo: GrupoContabil; codigo: string; nome: string }[] = [
  { grupo: "BNDES", codigo: "01", nome: "Financiamentos BNDES" },
  { grupo: "CCB", codigo: "02", nome: "Empréstimos bancários (CCB)" },
  { grupo: "Debêntures", codigo: "03", nome: "Debêntures" },
  { grupo: "CRA/CRI", codigo: "04", nome: "Certificados de recebíveis (CRA/CRI)" },
];

/** Plano de contas do passivo de captações no FI-GL (ambiente de teste) */
export const CONTAS_CONTABEIS: ContaContabil[] = GRUPOS.flatMap((g) =>
  RUBRICAS.map((r) => ({
    conta: `${r.prefixo}.4.${g.codigo}.${r.sufixo}`,
    descricao: `${g.nome} – ${r.rotulo}`,
    grupo: g.grupo,
    rubrica: r.rubrica,
  })),
);

/** Fonte do extrato externo usado na conciliação TRM × extrato */
export function fonteExtrato(m: Modalidade): string {
  if (m === "BNDES FINEM" || m === "BNDES FINAME") return "BNDES – extrato do contrato (portal do cliente)";
  if (m === "CCB") return "Banco credor – extrato da CCB";
  if (m === "CRA" || m === "CRI") return "Securitizadora – relatório mensal (PU × quantidade)";
  return "Agente fiduciário – PU × quantidade de debêntures";
}

/** Diferenças simuladas na data-base mais recente (demonstração das exceções de conciliação) */
export const DIFERENCAS_GL: { dataBase: string; conta: string; valor: number; motivo: string }[] = [
  {
    dataBase: "2026-03-31",
    conta: "2.1.4.03.2",
    valor: -12_480.55,
    motivo: "Apropriação de juros da DEB-03 (TPM44) executada após o corte do FI-GL – reprocessar e contabilizar",
  },
];

export const DIFERENCAS_EXTRATO: { dataBase: string; contrato: string; valor: number; motivo: string }[] = [
  {
    dataBase: "2026-03-31",
    contrato: "CRA-01",
    valor: 3_412.9,
    motivo: "PU da securitizadora calculado com IPCA projetado; TRM usa o último IPCA importado – validar com a securitizadora",
  },
];

export const TOLERANCIA_CONCILIACAO = 10;

export type StatusEtapa = "Concluído" | "Com pendência" | "Pendente";

export interface EtapaChecklist {
  id: string;
  dia: string; // DU-2 … DU+3
  etapa: string;
  transacao: string | null;
  responsavel: string;
}

export const CHECKLIST_FECHAMENTO: EtapaChecklist[] = [
  { id: "mercado", dia: "DU-2", etapa: "Importar dados de mercado do mês (CDI, IPCA, TJLP, TLP)", transacao: null, responsavel: "Tesouraria" },
  { id: "captacoes", dia: "DU-1", etapa: "Revisar novas captações, custos de transação e cronogramas (C00)", transacao: null, responsavel: "Tesouraria" },
  { id: "tbb1", dia: "DU-1", etapa: "Contabilizar os fluxos do período (pagamentos de principal e juros)", transacao: "TBB1", responsavel: "Tesouraria" },
  { id: "tpm44", dia: "DU+1", etapa: "Apropriação por competência de juros e custos de transação", transacao: "TPM44", responsavel: "Contabilidade" },
  { id: "tpm1", dia: "DU+1", etapa: "Avaliação: atualização monetária (IPCA/TLP)", transacao: "TPM1", responsavel: "Contabilidade" },
  { id: "cplp", dia: "DU+1", etapa: "Reclassificação curto × longo prazo (CPC 26)", transacao: null, responsavel: "Contabilidade" },
  { id: "gl", dia: "DU+2", etapa: "Conciliar TRM × FI-GL por conta contábil", transacao: null, responsavel: "Contabilidade" },
  { id: "extratos", dia: "DU+2", etapa: "Conciliar TRM × extratos (BNDES, agente fiduciário, securitizadora, bancos)", transacao: null, responsavel: "Tesouraria" },
  { id: "covenants", dia: "DU+3", etapa: "Apurar covenants e registrar waivers (C04)", transacao: null, responsavel: "Tesouraria / RI" },
  { id: "aprovacao", dia: "DU+3", etapa: "Aprovação da Controladoria e fechamento do período", transacao: null, responsavel: "Controladoria" },
];
