import type { ClassificacaoCPC48, Rating } from "./carteira";

/**
 * R10 – Time deposits: depósitos a prazo no exterior (USD/EUR) – dados fictícios do ambiente de teste.
 * Parâmetros da aba "Premissas" (time deposit / aplicações no exterior) e posições da "Carteira-Mestre".
 */

export const PARAMETROS_TIME_DEPOSIT = {
  /**
   * IOF câmbio na remessa para investimento no exterior: 1,10% (Decreto 6.306/2007, art. 15-B, XXI-A, na redação do
   * Decreto 12.499/2025 – eficácia restabelecida pelo STF em 16/07/2025). Todas as remessas da carteira são posteriores.
   */
  iofCambio: 0.011,
  /** Alíquota geral do IOF câmbio (0,38%), vigente antes de 16/07/2025 para essas remessas – referência */
  iofCambioGeral: 0.0038,
  /** Início da alíquota de 1,10% para remessas de investimento */
  inicioIofInvestimento: "2025-07-16",
  /** Base de dias – convenção de mercado USD/EUR (ACT/360) */
  baseDias: 360,
  /** Tarifa bancária por operação (SWIFT/wire), em US$ */
  tarifaUSD: 50,
  /** Referências de mercado (exibição) */
  sofr: 0.043,
  estr: 0.024,
};

export interface TimeDeposit {
  id: string;
  transacao: string;
  empresa: string;
  banco: string;
  praca: string;
  grupo: string;
  rating: Rating;
  moeda: "USD" | "EUR";
  /** principal na moeda original */
  principal: number;
  /** taxa a.a. na moeda original, juros simples ACT/360 pagos no vencimento */
  taxa: number;
  referencia: string;
  dataAplicacao: string;
  vencimento: string;
  /** PTAX do fechamento de câmbio da remessa */
  ptaxAplicacao: number;
  portfolio: string;
  cpc48: ClassificacaoCPC48;
}

export const TIME_DEPOSITS: TimeDeposit[] = [
  {
    id: "TDP01",
    transacao: "60000011",
    empresa: "1000",
    banco: "Itaú BBA Nassau",
    praca: "Nassau (Bahamas)",
    grupo: "Itaú Unibanco",
    rating: "AAA",
    moeda: "USD",
    principal: 500_000,
    taxa: 0.0485,
    referencia: "SOFR + 0,55%",
    dataAplicacao: "2025-10-15",
    vencimento: "2026-04-15",
    ptaxAplicacao: 5.35,
    portfolio: "TES-EXTERIOR",
    cpc48: "Custo Amortizado",
  },
  {
    id: "TDP02",
    transacao: "60000018",
    empresa: "1000",
    banco: "Bradesco Grand Cayman",
    praca: "George Town (Ilhas Cayman)",
    grupo: "Bradesco",
    rating: "AAA",
    moeda: "USD",
    principal: 300_000,
    taxa: 0.046,
    referencia: "SOFR + 0,30%",
    dataAplicacao: "2025-12-01",
    vencimento: "2026-06-01",
    ptaxAplicacao: 5.4,
    portfolio: "TES-EXTERIOR",
    cpc48: "Custo Amortizado",
  },
  {
    id: "TDP03",
    transacao: "60000024",
    empresa: "3000",
    banco: "BTG Pactual Luxembourg",
    praca: "Luxemburgo",
    grupo: "BTG Pactual",
    rating: "AA",
    moeda: "EUR",
    principal: 250_000,
    taxa: 0.029,
    referencia: "€STR + 0,50%",
    dataAplicacao: "2025-11-10",
    vencimento: "2026-05-11",
    ptaxAplicacao: 6.12,
    portfolio: "TES-EXTERIOR",
    cpc48: "Custo Amortizado",
  },
  {
    id: "TDP04",
    transacao: "60000031",
    empresa: "3000",
    banco: "Santander Madrid",
    praca: "Madri (Espanha)",
    grupo: "Santander",
    rating: "AAA",
    moeda: "EUR",
    principal: 150_000,
    taxa: 0.0275,
    referencia: "€STR + 0,35%",
    dataAplicacao: "2026-02-02",
    vencimento: "2026-08-03",
    ptaxAplicacao: 6.05,
    portfolio: "TES-EXTERIOR",
    cpc48: "Custo Amortizado",
  },
];
