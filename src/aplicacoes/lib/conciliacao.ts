import { IMPORTACAO_SAP, premissasNaDataBase, ultimoDadoNaDataBase, type PremissasMercado } from "../../shared/data/mercado";
import type { Escopo } from "../../shared/data/empresas";
import { addDays, fmtDate, fromDay, isBusinessDay, previousMonthEnd, proximoDiaUtil, toDay } from "../../shared/lib/dates";
import { fmtBRL, fmtDec, plural } from "../../shared/lib/format";
import { chavePremissas, ptaxNaData } from "../../shared/lib/taxas";
import { OPERACOES } from "../data/carteira";
import { FUNDOS } from "../data/fundos";
import { TITULOS } from "../data/tesouro";
import { TIME_DEPOSITS } from "../data/timeDeposits";
import { contratosMestre, movimentacaoMestre, TIPOS_CONTRATO, type ContratoMestre, type MovMestre, type TipoContrato } from "./carteiraMestre";
import { posicoesEm } from "./finance";
import { cotaFundo, posicaoFundo } from "./fundos";
import { posicaoTitulo, puTitulo } from "./tesouro";
import { posicaoTimeDeposit, saldoME } from "./timeDeposit";

/**
 * Motor da conciliação de fim de mês das aplicações financeiras (R12): TRM (Carteira-Mestre) × FI-GL por conta contábil
 * e tipo de contrato, TRM × extratos externos, roll-forward do mês com checagens de integridade e checklist de fechamento
 * (DU-1 a DU+3). As diferenças são fictícias e determinísticas (dependem da data-base), sempre com a causa apurada.
 * Usado pela tela do R12 e pelo Launchpad/alertas (`resumoConciliacao`).
 */

export type StatusConc = "Conciliado" | "Diferença explicada" | "Pendente";
/** timing = lançamento em outro período; preco = fonte de preço diferente; pendente = sem explicação aceita */
export type Natureza = "timing" | "preco" | "pendente";
export type StatusEtapa = "Concluída" | "Com ressalva" | "Pendente";
export type Responsavel = "Tesouraria" | "Contabilidade" | "Controladoria";
export type MoedaME = "USD" | "EUR";

/** Diferenças de até R$ 1,00 por linha são arredondamento (conciliado) */
export const TOLERANCIA = 1;
export const TOLERANCIA_TXT = fmtBRL(TOLERANCIA, true);

// ---------------------------------------------------------------------------
// Plano de contas (ambiente de teste – fictício) e determinação de contas
// ---------------------------------------------------------------------------

export interface ContaPlano {
  conta: string;
  descricao: string;
  circulante: boolean;
  componente: "curva" | "mtm";
  regra: string;
}

export const PLANO_CONTAS: ContaPlano[] = [
  {
    conta: "1.1.2.01",
    descricao: "Aplicações financeiras – renda fixa bancária",
    circulante: true,
    componente: "curva",
    regra: "Renda fixa bancária realizável em até 12 meses ou VJR · principal + juros (curva)",
  },
  {
    conta: "1.1.2.02",
    descricao: "Títulos públicos federais",
    circulante: true,
    componente: "curva",
    regra: "Tesouro Direto com vencimento em até 12 meses ou mantido para negociação (VJR) · PU na curva × quantidade",
  },
  {
    conta: "1.1.2.03",
    descricao: "Cotas de fundos de investimento",
    circulante: true,
    componente: "curva",
    regra: "Fundos de investimento · cota × quantidade (valor justo por resultado)",
  },
  {
    conta: "1.1.2.04",
    descricao: "Aplicações no exterior – time deposits",
    circulante: true,
    componente: "curva",
    regra: "Time deposits com vencimento em até 12 meses · saldo em moeda × PTAX de fechamento",
  },
  {
    conta: "1.1.2.09",
    descricao: "Ajuste a valor justo (MTM) – circulante",
    circulante: true,
    componente: "mtm",
    regra: "Contratos circulantes a valor justo (VJORA/VJR) · mercado − curva (acréscimo ou redutora)",
  },
  {
    conta: "1.2.1.01",
    descricao: "Aplicações financeiras – não circulante",
    circulante: false,
    componente: "curva",
    regra: "Contratos com vencimento acima de 12 meses, exceto VJR (qualquer tipo) · curva",
  },
  {
    conta: "1.2.1.09",
    descricao: "Ajuste a valor justo (MTM) – não circulante",
    circulante: false,
    componente: "mtm",
    regra: "Contratos não circulantes a valor justo (VJORA/VJR) · mercado − curva (acréscimo ou redutora)",
  },
];

export function contaCurva(c: ContratoMestre): string {
  if (!c.circulante) return "1.2.1.01";
  if (c.tipo === "Renda fixa bancária") return "1.1.2.01";
  if (c.tipo === "Tesouro Direto") return "1.1.2.02";
  if (c.tipo === "Fundo de investimento") return "1.1.2.03";
  return "1.1.2.04";
}

export function contaMTM(c: ContratoMestre): string {
  return c.circulante ? "1.1.2.09" : "1.2.1.09";
}

/** Base do saldo TRM comparado com o extrato de cada tipo de contrato */
export const BASE_EXTRATO: Record<TipoContrato, string> = {
  "Renda fixa bancária": "Curva",
  "Tesouro Direto": "Mercado (PU ANBIMA)",
  "Fundo de investimento": "Cota × quantidade",
  "Time deposit": "ME × PTAX",
};

export const FONTE_TIPO: Record<TipoContrato, string> = {
  "Renda fixa bancária": "Bancos emissores e B3",
  "Tesouro Direto": "B3 / agentes de custódia",
  "Fundo de investimento": "Administradores",
  "Time deposit": "Bancos no exterior (ME)",
};

/** Fundos que divulgam a cota de fechamento em D+1 (multimercado, ações e cambial) */
const CLASSES_COTA_D1 = new Set(["Multimercado macro", "Ações", "Cambial"]);

// ---------------------------------------------------------------------------
// Checklist de fechamento
// ---------------------------------------------------------------------------

export interface Etapa {
  id: string;
  du: number;
  etapa: string;
  transacao: string | null;
  responsavel: Responsavel;
}

export const ETAPAS: Etapa[] = [
  {
    id: "mercado",
    du: -1,
    etapa: "Importar dados de mercado para o SAP: PTAX (TCURR), taxas indicativas ANBIMA/PU dos títulos, cotas de fundos e índices (CDI/IPCA)",
    transacao: null,
    responsavel: "Tesouraria",
  },
  { id: "tbb1", du: 0, etapa: "Lançamento dos fluxos do mês: aplicações, juros recebidos, resgates, cupons e come-cotas", transacao: "TBB1", responsavel: "Tesouraria" },
  { id: "tpm10", du: 0, etapa: "Fixar/lançar/estornar operações da gestão de posições (pendentes)", transacao: "TPM10", responsavel: "Tesouraria" },
  { id: "tpm44", du: 0, etapa: "Apropriação/diferimento (accrual/deferral) dos juros por competência", transacao: "TPM44", responsavel: "Contabilidade" },
  { id: "tpm1", du: 1, etapa: "Avaliação: marcação a mercado dos títulos e variação cambial dos time deposits", transacao: "TPM1", responsavel: "Contabilidade" },
  {
    id: "diario",
    du: 1,
    etapa: "Conferência dos lançamentos: logs da TBB1, TPM44 e TPM1 e partidas do razão por conta (FAGLL03 ou FBL3N)",
    transacao: "FAGLL03",
    responsavel: "Contabilidade",
  },
  { id: "gl", du: 2, etapa: "Conciliar TRM × FI-GL por conta contábil e tipo de contrato (esta tela)", transacao: null, responsavel: "Contabilidade" },
  {
    id: "extratos",
    du: 2,
    etapa: "Conciliar TRM × extratos: bancos, B3/custodiantes, administradores de fundos e bancos no exterior (esta tela)",
    transacao: null,
    responsavel: "Tesouraria",
  },
  { id: "rollforward", du: 2, etapa: "Roll-forward do mês e checagens de integridade (esta tela)", transacao: null, responsavel: "Controladoria" },
  { id: "aprovacao", du: 3, etapa: "Aprovação da Controladoria e envio dos saldos para a nota explicativa (R02)", transacao: null, responsavel: "Controladoria" },
];

export const TRANSACOES_SAP: { codigo: string; descricao: string }[] = [
  { codigo: "TBB1", descricao: "Lançamento dos fluxos (aplicações, resgates, juros recebidos, cupons e come-cotas) no FI-GL" },
  { codigo: "TPM10", descricao: "Fixar, lançar ou estornar operações da gestão de posições (pendentes)" },
  { codigo: "TPM44", descricao: "Apropriação/diferimento (accrual/deferral) dos juros das aplicações por competência" },
  { codigo: "TPM1", descricao: "Avaliação: MTM dos títulos a valor justo (VJORA/VJR) e variação cambial dos time deposits" },
  { codigo: "FAGLL03", descricao: "Partidas individuais do razão por conta (ou FBL3N) – conferência dos lançamentos antes da conciliação" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const r2 = (v: number) => Math.round(v * 100) / 100;
const arred = (v: number, casas: number) => Math.round(v * 10 ** casas) / 10 ** casas;
const truncar = (v: number, casas: number) => Math.trunc(v * 10 ** casas + 1e-9) / 10 ** casas;

/** Diferença com sinal explícito (+/−); zero sem sinal */
export function fmtDif(v: number, casas = 2): string {
  if (Math.abs(v) < 0.5 / 10 ** casas) return fmtDec(0, casas);
  return `${v > 0 ? "+" : "−"}${fmtDec(Math.abs(v), casas)}`;
}

export function fmtDifBRL(v: number): string {
  if (Math.abs(v) < 0.005) return fmtBRL(0, true);
  return `${v > 0 ? "+" : "−"}${fmtBRL(Math.abs(v), true)}`;
}

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

export function diaSemana(iso: string): string {
  return DIAS_SEMANA[(((toDay(iso) + 4) % 7) + 7) % 7];
}

/**
 * Calendário de fechamento (feriados nacionais – base ANBIMA): DU0 = último dia útil do mês da data-base; DU-n = n-ésimo
 * dia útil anterior; DU+n = n-ésimo dia útil após o fim do mês.
 */
export function diaUtil(dataBase: string, n: number): string {
  if (n > 0) {
    let d = dataBase;
    for (let k = 0; k < n; k++) d = proximoDiaUtil(addDays(d, 1));
    return d;
  }
  let d = toDay(dataBase);
  while (!isBusinessDay(d)) d--;
  for (let k = 0; k > n; k--) {
    d--;
    while (!isBusinessDay(d)) d--;
  }
  return fromDay(d);
}

export function rotuloDU(n: number): string {
  return n === 0 ? "DU0" : n > 0 ? `DU+${n}` : `DU${n}`;
}

/** Último dia útil local do banco no exterior (segunda a sexta) até a data */
function ultimoDiaUtilExterior(iso: string): string {
  let d = toDay(iso);
  for (;;) {
    const dow = (((d + 4) % 7) + 7) % 7;
    if (dow !== 0 && dow !== 6) return fromDay(d);
    d--;
  }
}

const curtoTipo = (t: TipoContrato) => TIPOS_CONTRATO.find((x) => x.tipo === t)!.curto;

// ---------------------------------------------------------------------------
// Tipos do resultado
// ---------------------------------------------------------------------------

export interface ItemDif {
  natureza: Natureza;
  valor: number;
  texto: string;
}

export interface LinhaGL {
  chave: string;
  conta: ContaPlano;
  tipo: TipoContrato;
  contratos: number;
  saldoTRM: number;
  saldoGL: number;
  diferenca: number;
  arredondamento: number;
  itens: ItemDif[];
  status: StatusConc;
  motivo: string | null;
}

export interface DetalheTitulo {
  tipo: "titulo";
  custodiante: string;
  quantidade: number;
  puTRM: number;
  puExtrato: number;
  taxaTRM: number;
  taxaExtrato: number;
}

export interface DetalheFundo {
  tipo: "fundo";
  administrador: string;
  quantidade: number;
  quantidadeExtrato: number;
  cotaTRM: number;
  cotaExtrato: number;
  dataCota: string;
  d1: boolean;
}

export interface DetalheTD {
  tipo: "td";
  banco: string;
  moeda: MoedaME;
  saldoTRMME: number;
  saldoExtratoME: number;
  ptax: number;
  dataExtrato: string;
}

export interface LinhaExtrato {
  c: ContratoMestre;
  fonte: string;
  base: string;
  saldoTRM: number;
  saldoExtrato: number;
  diferenca: number;
  itens: ItemDif[];
  status: StatusConc;
  motivo: string | null;
  detalhe: DetalheTitulo | DetalheFundo | DetalheTD | null;
}

export interface Checagem {
  id: string;
  descricao: string;
  ok: boolean;
  detalhe: string;
}

export interface EtapaStatus extends Etapa {
  data: string;
  status: StatusEtapa;
  nota: string | null;
}

/** Diferença "Pendente" (bloqueia a aprovação) – título curto para alertas e descrição com valor e ação */
export interface PendenciaConciliacao {
  id: string;
  origem: "gl" | "extrato";
  titulo: string;
  descricao: string;
  valor: number;
}

function statusDe(itens: ItemDif[], diferenca: number): StatusConc {
  if (itens.some((i) => i.natureza === "pendente")) return "Pendente";
  return Math.abs(diferenca) > TOLERANCIA ? "Diferença explicada" : "Conciliado";
}

function motivoDe(itens: ItemDif[], arredondamento: number, textoArred: string): string | null {
  const textos = itens.map((i) => i.texto);
  if (Math.abs(arredondamento) >= 0.005) textos.push(itens.length ? `Inclui ${fmtDifBRL(arredondamento)} de arredondamento.` : textoArred);
  return textos.length ? textos.join(" ") : null;
}

/** SF − (SI + aplicações + rendimentos − resgates − come-cotas) */
export function identidade(m: MovMestre): number {
  return m.saldoFinal - (m.saldoInicial + m.aplicacoes + m.rendimentos - m.resgatesBrutos - m.comeCotas);
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

export function montarConciliacao(db: string, p: PremissasMercado, escopo: Escopo) {
  const inicio = previousMonthEnd(db);
  /** fechamento em andamento: a data-base é o último dado importado do SAP (meses anteriores já aprovados) */
  const emAndamento = db === IMPORTACAO_SAP.ultimoDadoDisponivel;
  const du0 = diaUtil(db, 0);
  const duM1 = diaUtil(db, -1);
  const du1 = diaUtil(db, 1);
  const noEscopo = (empresa: string) => escopo === "todas" || empresa === escopo;

  const contratos = contratosMestre(db, p, escopo);
  const mov = movimentacaoMestre(inicio, db, p, escopo);

  // Exceções do fechamento em andamento (fictícias): a última aplicação de renda fixa do mês ficou sem a apropriação
  // (TPM44) no FI-GL e a primeira, indexada ao CDI, tem extrato do banco com taxa diferente da negociada.
  const aplicacoesRF = mov.eventos
    .filter((e) => e.tipo === "Aplicação" && e.tipoContrato === "Renda fixa bancária")
    .map((e) => contratos.find((c) => c.codigo === e.codigo))
    .filter((c): c is ContratoMestre => !!c);
  const opGL = emAndamento ? (aplicacoesRF[aplicacoesRF.length - 1] ?? null) : null;
  const opExtrato = emAndamento ? (aplicacoesRF.find((c) => c !== opGL && c.indexador === "CDI") ?? null) : null;
  const pendencias: PendenciaConciliacao[] = [];

  // ------------------------------------------------------------------ TRM × FI-GL
  const grupos = new Map<string, { conta: ContaPlano; tipo: TipoContrato; itens: { c: ContratoMestre; v: number }[] }>();
  const adicionar = (conta: string, c: ContratoMestre, v: number) => {
    const k = `${conta}|${c.tipo}`;
    let g = grupos.get(k);
    if (!g) {
      g = { conta: PLANO_CONTAS.find((x) => x.conta === conta)!, tipo: c.tipo, itens: [] };
      grupos.set(k, g);
    }
    g.itens.push({ c, v });
  };
  for (const c of contratos) {
    adicionar(contaCurva(c), c, c.saldoCurva);
    const mtm = c.valorContabil - c.saldoCurva;
    if (c.cpc48 !== "Custo Amortizado" && Math.abs(mtm) >= 0.005) adicionar(contaMTM(c), c, mtm);
  }

  const ptaxFim: Record<MoedaME, number> = { USD: p.ptaxUSD, EUR: p.ptaxEUR };
  /** PTAX do dia útil anterior: interpolada da série mensal importada, com 4 casas como a PTAX publicada */
  const ptaxAnterior: Record<MoedaME, number> = { USD: arred(ptaxNaData("USD", duM1, p), 4), EUR: arred(ptaxNaData("EUR", duM1, p), 4) };
  const comeCotas = mov.eventos.filter((e) => e.tipo === "Come-cotas");

  const gl: LinhaGL[] = [];
  /** saldos TRM sem arredondamento por linha (checagens contra a Carteira-Mestre) */
  let mtmContabil = 0;
  let circulante = 0;
  for (const conta of PLANO_CONTAS) {
    for (const t of TIPOS_CONTRATO) {
      const g = grupos.get(`${conta.conta}|${t.tipo}`);
      if (!g) continue;
      const exato = g.itens.reduce((s, i) => s + i.v, 0);
      if (conta.componente === "mtm") mtmContabil += exato;
      if (conta.circulante) circulante += exato;
      // saldo da linha arredondado a centavos: totais e arredondamento são somas das linhas exibidas
      const saldoTRM = r2(exato);
      const itens: ItemDif[] = [];
      if (conta.componente === "curva" && t.tipo === "Time deposit") {
        const moedas = [...new Set(g.itens.map((i) => i.c.moeda))].filter((m): m is MoedaME => m !== "BRL");
        const porMoeda = moedas.map((m) => {
          const cs = g.itens.filter((i) => i.c.moeda === m);
          return {
            m,
            me: cs.reduce((s, i) => s + i.c.saldoME, 0),
            valor: r2(cs.reduce((s, i) => s + i.c.saldoME * (ptaxAnterior[m] - i.c.ptax), 0)),
          };
        });
        const valor = r2(porMoeda.reduce((s, x) => s + x.valor, 0));
        if (Math.abs(valor) >= 0.005)
          itens.push({
            natureza: "timing",
            valor,
            texto: `Variação cambial de ${fmtDate(du0)} (último dia útil) contabilizada em D+1, ${fmtDate(du1)}: o FI-GL está avaliado à PTAX do dia útil anterior, ${fmtDate(duM1)} (interpolada da série mensal importada), e o TRM à PTAX de fechamento – ${porMoeda.map((x) => `${x.m} ${fmtDec(x.me, 2)} × (${fmtDec(ptaxAnterior[x.m], 4)} − ${fmtDec(ptaxFim[x.m], 4)}) = ${fmtDifBRL(x.valor)}`).join("; ")}. Diferença temporária, regulariza no mês seguinte.`,
          });
      }
      if (conta.componente === "curva" && t.tipo === "Fundo de investimento" && comeCotas.length) {
        const valor = r2(comeCotas.reduce((s, e) => s + e.ir, 0));
        itens.push({
          natureza: "timing",
          valor,
          texto: `Come-cotas de ${fmtDate(comeCotas[0].data)} (IR de ${fmtBRL(valor, true)} em ${plural(comeCotas.length, "fundo", "fundos")}) informado pelos administradores e contabilizado em D+1, ${fmtDate(du1)}: o FI-GL ainda não reflete a redução das cotas (contrapartida em IRRF a compensar).`,
        });
      }
      if (opGL && conta.componente === "curva" && t.tipo === opGL.tipo && contaCurva(opGL) === conta.conta) {
        const juros = r2(opGL.saldoCurva - opGL.principalBRL);
        itens.push({
          natureza: "pendente",
          valor: -juros,
          texto: `Log da TPM44 com erro na operação ${opGL.codigo} (${opGL.produto} ${opGL.contraparte}, aplicada em ${fmtDate(opGL.dataAplicacao)}): determinação de contas não encontrada – juros de ${fmtBRL(juros, true)} apropriados no TRM e não contabilizados. Corrigir e reprocessar a TPM44.`,
        });
        pendencias.push({
          id: `gl-${opGL.codigo}`,
          origem: "gl",
          titulo: `Juros não contabilizados – TPM44 · operação ${opGL.codigo}`,
          descricao: `Conta ${conta.conta}: juros de ${fmtBRL(juros, true)} da operação ${opGL.codigo} (${opGL.produto} ${opGL.contraparte}) apropriados no TRM e não contabilizados no FI-GL – corrigir a determinação de contas e reprocessar a TPM44.`,
          valor: -juros,
        });
      }
      // razão com lançamentos por contrato em centavos; nas linhas com diferença apurada, o saldo do razão é o saldo TRM
      // da linha mais os itens
      const explicado = r2(itens.reduce((s, i) => s + i.valor, 0));
      const saldoGL = itens.length ? r2(saldoTRM + explicado) : r2(g.itens.reduce((s, i) => s + r2(i.v), 0));
      const diferenca = r2(saldoGL - saldoTRM);
      const arredondamento = r2(diferenca - explicado);
      gl.push({
        chave: `${conta.conta}|${t.tipo}`,
        conta,
        tipo: t.tipo,
        contratos: new Set(g.itens.map((i) => i.c.id)).size,
        saldoTRM,
        saldoGL,
        diferenca,
        arredondamento,
        itens,
        status: statusDe(itens, diferenca),
        motivo: motivoDe(itens, arredondamento, "Arredondamento de centavos nos lançamentos por contrato."),
      });
    }
  }

  // ------------------------------------------------------------------ TRM × extratos
  const extratos: LinhaExtrato[] = [];
  for (const t of TIPOS_CONTRATO) {
    for (const c of contratos.filter((x) => x.tipo === t.tipo)) {
      const itens: ItemDif[] = [];
      let saldoTRM = r2(c.saldoCurva);
      let saldoExtrato = saldoTRM;
      let fonte = "";
      let textoArred = "Arredondamento de centavos – dentro da tolerância.";
      let detalhe: LinhaExtrato["detalhe"] = null;

      if (c.tipo === "Renda fixa bancária") {
        const titulo = c.produto === "Debênture" || c.produto === "CRI" || c.produto === "CRA";
        fonte = titulo ? `B3 – extrato de custódia (${c.contraparte})` : `${c.contraparte} – extrato de posição`;
        saldoExtrato = r2(c.principalBRL * truncar(c.saldoCurva / c.principalBRL, 8));
        textoArred = "Fator acumulado truncado na 8ª casa decimal pelo emissor – centavos.";
        if (opExtrato && c.id === opExtrato.id) {
          const taxa = OPERACOES.find((o) => o.transacao === c.id)?.taxa ?? 1;
          const juros = c.saldoCurva - c.principalBRL;
          const valor = -r2((juros * 0.01) / taxa);
          saldoExtrato = r2(saldoTRM + valor);
          itens.push({
            natureza: "pendente",
            valor,
            texto: `Extrato do ${c.contraparte} remunera ${fmtDec((taxa - 0.01) * 100, 1)}% do CDI; a nota de negociação e o cadastro do TRM têm ${fmtDec(taxa * 100, 1)}% do CDI (juros desde ${fmtDate(c.dataAplicacao)}). Contestar com o banco antes da aprovação.`,
          });
          pendencias.push({
            id: `extrato-${c.codigo}`,
            origem: "extrato",
            titulo: `Taxa divergente no extrato – ${c.contraparte} · operação ${c.codigo}`,
            descricao: `Extrato do ${c.contraparte} com ${fmtDec((taxa - 0.01) * 100, 1)}% do CDI × ${fmtDec(taxa * 100, 1)}% negociados na operação ${c.codigo} (${c.produto}): saldo ${fmtBRL(Math.abs(valor), true)} menor que o TRM – contestar com o banco antes da aprovação.`,
            valor,
          });
        }
      } else if (c.tipo === "Tesouro Direto") {
        const tit = TITULOS.find((x) => x.id === c.codigo)!;
        const x = posicaoTitulo(tit, db, p);
        // agente com fonte de preço própria: ±1 bp sobre a taxa indicativa ANBIMA (sinal alterna com o mês)
        const bp = tit.custodiante.includes("Bradesco") ? (Number(db.slice(5, 7)) % 2 === 1 ? 1 : -1) : 0;
        const taxaExtrato = x.taxaMercado + bp / 10_000;
        const puExtrato = truncar(bp ? puTitulo(tit, db, taxaExtrato, p) : x.puMercado, 6);
        fonte = `${tit.custodiante} – PU de mercado`;
        saldoTRM = r2(c.saldoMercado);
        saldoExtrato = r2(tit.quantidade * puExtrato);
        textoArred = "PU truncado na 6ª casa decimal (convenção B3/Tesouro) – centavos.";
        const dif = r2(saldoExtrato - saldoTRM);
        if (bp && Math.abs(dif) > TOLERANCIA)
          itens.push({
            natureza: "preco",
            valor: dif,
            texto: `PU do agente (${fmtDec(puExtrato, 6)}) calculado com taxa de ${fmtDec(taxaExtrato * 100, 2)}% – fonte própria, ${bp > 0 ? "+" : "−"}1 bp sobre a taxa indicativa ANBIMA de ${fmtDec(x.taxaMercado * 100, 2)}% usada no TRM. Diferença de precificação, sem ajuste contábil.`,
          });
        detalhe = {
          tipo: "titulo",
          custodiante: tit.custodiante,
          quantidade: tit.quantidade,
          puTRM: x.puMercado,
          puExtrato,
          taxaTRM: x.taxaMercado,
          taxaExtrato: bp ? taxaExtrato : x.taxaMercado,
        };
      } else if (c.tipo === "Fundo de investimento") {
        const f = FUNDOS.find((x) => x.id === c.codigo)!;
        const pos = posicaoFundo(f, db, p);
        const d1 = CLASSES_COTA_D1.has(f.classe);
        const dataCota = d1 ? duM1 : db;
        const cotaExtrato = arred(cotaFundo(f, dataCota, p), 8);
        const quantidadeExtrato = arred(pos.quantidade, 6);
        fonte = `${f.administrador} – posição de cotas`;
        saldoExtrato = r2(quantidadeExtrato * cotaExtrato);
        textoArred = "Quantidade (6 casas) e cota (8 casas) arredondadas pelo administrador – centavos.";
        const dif = r2(saldoExtrato - saldoTRM);
        if (d1 && Math.abs(dif) > TOLERANCIA)
          itens.push({
            natureza: "timing",
            valor: dif,
            texto: `Posição extraída em ${rotuloDU(0)} com a cota de ${fmtDate(dataCota)} (${fmtDec(cotaExtrato, 8)}): a cota de fechamento é divulgada pelo administrador em D+1. Diferença temporária – confirmar com a cota publicada em ${fmtDate(du1)}.`,
          });
        detalhe = {
          tipo: "fundo",
          administrador: f.administrador,
          quantidade: pos.quantidade,
          quantidadeExtrato,
          cotaTRM: pos.cota,
          cotaExtrato,
          dataCota,
          d1,
        };
      } else {
        const td = TIME_DEPOSITS.find((x) => x.id === c.codigo)!;
        const dataExtrato = ultimoDiaUtilExterior(db);
        const saldoExtratoME = r2(saldoME(td, dataExtrato));
        fonte = `${td.banco} – extrato em ${td.moeda}`;
        saldoExtrato = r2(saldoExtratoME * c.ptax);
        textoArred = `Saldo em ${td.moeda} arredondado a centavos pelo banco.`;
        const dias = toDay(db) - toDay(dataExtrato);
        const dif = r2(saldoExtrato - saldoTRM);
        if (dias > 0 && Math.abs(dif) > TOLERANCIA)
          itens.push({
            natureza: "timing",
            valor: dif,
            texto: `Extrato emitido em ${fmtDate(dataExtrato)} (último dia útil local): juros de ${plural(dias, "dia corrido", "dias corridos")} até a data-base não incluídos (${td.moeda} ${fmtDec(saldoExtratoME - c.saldoME, 2)}). Diferença temporária.`,
          });
        detalhe = {
          tipo: "td",
          banco: td.banco,
          moeda: td.moeda,
          saldoTRMME: c.saldoME,
          saldoExtratoME,
          ptax: c.ptax,
          dataExtrato,
        };
      }

      const diferenca = r2(saldoExtrato - saldoTRM);
      const explicado = r2(itens.reduce((s, i) => s + i.valor, 0));
      const resto = r2(diferenca - explicado);
      extratos.push({
        c,
        fonte,
        base: BASE_EXTRATO[c.tipo],
        saldoTRM,
        saldoExtrato,
        diferenca,
        itens,
        status: statusDe(itens, diferenca),
        motivo: motivoDe(itens, resto, textoArred),
        detalhe,
      });
    }
  }

  // ------------------------------------------------------------------ Roll-forward e checagens
  const porTipo = TIPOS_CONTRATO.map((t) => {
    const cs = contratos.filter((c) => c.tipo === t.tipo);
    return {
      ...t,
      mov: mov.porTipo[t.tipo],
      carteira: cs.reduce((s, c) => s + c.saldoCurva, 0),
      contabil: cs.reduce((s, c) => s + c.valorContabil, 0),
      contratos: cs.length,
    };
  });
  const saldoCarteira = contratos.reduce((s, c) => s + c.saldoCurva, 0);
  const valorContabil = contratos.reduce((s, c) => s + c.valorContabil, 0);
  const pAnterior = premissasNaDataBase(inicio);
  const saldoAnterior = contratosMestre(inicio, pAnterior, escopo).reduce((s, c) => s + c.saldoCurva, 0);
  const difIdentidade = Math.max(Math.abs(identidade(mov.total)), ...porTipo.map((t) => Math.abs(identidade(t.mov))));
  const difSaldoFinal = mov.total.saldoFinal - saldoCarteira;
  const difSaldoInicial = mov.total.saldoInicial - saldoAnterior;
  const rollforwardOk = difIdentidade < 0.005 && Math.abs(difSaldoFinal) < 0.005;

  const mtmVJORA = contratos.filter((c) => c.cpc48 === "VJ por ORA").reduce((s, c) => s + c.valorContabil - c.saldoCurva, 0);
  const mtmVJR = contratos.filter((c) => c.cpc48 === "VJ por Resultado").reduce((s, c) => s + c.valorContabil - c.saldoCurva, 0);
  const mtmCusto = contratos.filter((c) => c.cpc48 === "Custo Amortizado").reduce((s, c) => s + c.mtm, 0);
  const mtmCalculado = contratos.filter((c) => c.cpc48 !== "Custo Amortizado").reduce((s, c) => s + c.mtm, 0);

  // totais dos relatórios de origem (motores do R01, R08, R09 e R10)
  const r01 = posicoesEm(
    OPERACOES.filter((o) => noEscopo(o.empresa)),
    db,
    p,
  );
  const r08 = TITULOS.filter((t) => noEscopo(t.empresa))
    .map((t) => posicaoTitulo(t, db, p))
    .filter((x) => x.ativo);
  const r09 = FUNDOS.filter((f) => noEscopo(f.empresa))
    .map((f) => posicaoFundo(f, db, p))
    .filter((x) => x.ativo);
  const r10 = TIME_DEPOSITS.filter((t) => noEscopo(t.empresa))
    .map((t) => posicaoTimeDeposit(t, db, p))
    .filter((x) => x.ativo);
  const origem = [
    { id: "r01", rel: "R01", tipo: "Renda fixa bancária" as TipoContrato, n: r01.length, total: r01.reduce((s, x) => s + x.valorContabil, 0), un: ["operação", "operações"] },
    { id: "r08", rel: "R08", tipo: "Tesouro Direto" as TipoContrato, n: r08.length, total: r08.reduce((s, x) => s + x.valorContabil, 0), un: ["título", "títulos"] },
    { id: "r09", rel: "R09", tipo: "Fundo de investimento" as TipoContrato, n: r09.length, total: r09.reduce((s, x) => s + x.saldo, 0), un: ["fundo", "fundos"] },
    { id: "r10", rel: "R10", tipo: "Time deposit" as TipoContrato, n: r10.length, total: r10.reduce((s, x) => s + x.saldoBRL, 0), un: ["time deposit", "time deposits"] },
  ];

  const tds = contratos.filter((c) => c.tipo === "Time deposit");
  const moedasTD = [...new Set(tds.map((c) => c.moeda))].filter((m): m is MoedaME => m !== "BRL");
  const ptaxOk = tds.every((c) => c.moeda !== "BRL" && Math.abs(c.ptax - ptaxFim[c.moeda]) < 1e-9);
  const extFundos = extratos.filter((l) => l.c.tipo === "Fundo de investimento");
  const fundosIguais = extFundos.filter((l) => l.detalhe?.tipo === "fundo" && !l.detalhe.d1).length;
  const fundosD1 = extFundos.length - fundosIguais;
  const fmt2 = (v: number) => fmtDec(v, 2);

  const checagens: Checagem[] = [
    {
      id: "identidade",
      descricao: "Roll-forward fecha: SF = SI + aplicações + rendimentos − resgates − come-cotas",
      ok: difIdentidade < 0.005,
      detalhe: `Diferença de R$ ${fmt2(difIdentidade)} no total e em cada tipo de contrato`,
    },
    {
      id: "saldoFinal",
      descricao: `Saldo final do roll-forward = Σ saldo bruto da Carteira-Mestre em ${fmtDate(db)}`,
      ok: Math.abs(difSaldoFinal) < 0.005,
      detalhe: `${fmtBRL(saldoCarteira, true)} em ${plural(contratos.length, "contrato", "contratos")} · diferença de R$ ${fmt2(Math.abs(difSaldoFinal))}`,
    },
    {
      id: "saldoInicial",
      descricao: `Saldo inicial = saldo do fechamento de ${fmtDate(inicio)}`,
      ok: Math.abs(difSaldoInicial) < 0.005,
      detalhe: `${fmtBRL(saldoAnterior, true)} (Carteira-Mestre com as premissas daquela data-base) · diferença de R$ ${fmt2(Math.abs(difSaldoInicial))}`,
    },
    ...origem.map((o) => {
      const mestre = porTipo.find((t) => t.tipo === o.tipo)!;
      const dif = o.total - mestre.contabil;
      return {
        id: o.id,
        descricao: `${curtoTipo(o.tipo)}: total do ${o.rel} × Carteira-Mestre (valor contábil)`,
        ok: Math.abs(dif) < 0.005 && o.n === mestre.contratos,
        detalhe: o.n
          ? `${fmtBRL(o.total, true)} em ${plural(o.n, o.un[0], o.un[1])} · diferença de R$ ${fmt2(Math.abs(dif))}`
          : `Sem ${o.un[1]} na empresa selecionada`,
      };
    }),
    {
      id: "mtm",
      descricao: "MTM contábil (contas 1.1.2.09 e 1.2.1.09) = MTM calculado dos contratos a valor justo",
      ok: Math.abs(mtmContabil - mtmCalculado) < 0.005,
      detalhe: `${fmtBRL(mtmContabil, true)} (VJORA ${fmtBRL(mtmVJORA, true)} · VJR ${fmtBRL(mtmVJR, true)}); o MTM de ${fmtBRL(mtmCusto, true)} dos contratos ao custo amortizado não é contabilizado – apenas divulgado (CPC 40)`,
    },
    {
      id: "ptax",
      descricao: "PTAX usada nos time deposits = PTAX importada (TCURR, tipo M)",
      ok: ptaxOk,
      detalhe: tds.length
        ? `${moedasTD.map((m) => `${m} ${fmtDec(ptaxFim[m], 4)}`).join(" · ")} de ${fmtDate(du0)} em ${plural(tds.length, "contrato", "contratos")}`
        : "Sem contratos em moeda estrangeira na empresa selecionada",
    },
    {
      id: "cotas",
      descricao: "Cotas do TRM × cotas informadas pelos administradores",
      ok: extFundos.every((l) => l.status !== "Pendente"),
      detalhe: extFundos.length
        ? `${fundosIguais} de ${plural(extFundos.length, "fundo", "fundos")} com a mesma cota${fundosD1 ? `; ${fundosD1} com a cota de ${fmtDate(duM1)} (divulgação em D+1 – diferença explicada)` : ""}`
        : "Sem fundos na empresa selecionada",
    },
    {
      id: "mercado",
      descricao: "Dados de mercado importados do SAP até a data-base",
      ok: db <= IMPORTACAO_SAP.ultimoDadoDisponivel,
      detalhe: `Último dado disponível na data-base: ${fmtDate(ultimoDadoNaDataBase(db))} – a conciliação não usa valores projetados`,
    },
  ];

  // ------------------------------------------------------------------ Checklist
  const glPend = gl.filter((l) => l.status === "Pendente");
  const glExp = gl.filter((l) => l.status === "Diferença explicada");
  const extPend = extratos.filter((l) => l.status === "Pendente");
  const extExp = extratos.filter((l) => l.status === "Diferença explicada");
  const checagensFalha = checagens.filter((c) => !c.ok);
  const fx = gl.flatMap((l) => (l.tipo === "Time deposit" ? l.itens.filter((i) => i.natureza === "timing") : []));
  const cc = gl.flatMap((l) => (l.tipo === "Fundo de investimento" ? l.itens.filter((i) => i.natureza === "timing") : []));
  const somaItens = (xs: ItemDif[]) => xs.reduce((s, i) => s + i.valor, 0);
  const qtdPendencias = glPend.length + extPend.length + checagensFalha.length;
  const fluxos = mov.eventos.length;

  const checklist: EtapaStatus[] = ETAPAS.map((e) => {
    let status: StatusEtapa = "Concluída";
    let nota: string | null = null;
    switch (e.id) {
      case "mercado":
        nota = `PTAX de fechamento${moedasTD.length ? ` (${moedasTD.map((m) => `${m} ${fmtDec(ptaxFim[m], 4)}`).join("; ")})` : ""}, taxas ANBIMA, cotas e CDI/IPCA carregados até ${fmtDate(ultimoDadoNaDataBase(db))}.`;
        break;
      case "tbb1":
        if (cc.length && Math.abs(somaItens(cc)) > TOLERANCIA) {
          status = "Com ressalva";
          nota = `Come-cotas (${fmtBRL(somaItens(cc), true)}) lançado em D+1 após o informe dos administradores – diferença temporária na conta 1.1.2.03.`;
        } else nota = fluxos ? `${plural(fluxos, "fluxo lançado", "fluxos lançados")} no mês.` : "Sem fluxos no mês.";
        break;
      case "tpm44":
        if (opGL) {
          status = "Com ressalva";
          nota = `Erro no log da operação ${opGL.codigo}: juros de ${fmtBRL(opGL.saldoCurva - opGL.principalBRL, true)} não contabilizados – reprocessar.`;
        }
        break;
      case "tpm10":
        nota = "Sem operações da gestão de posições pendentes de lançamento.";
        break;
      case "diario":
        nota = opGL
          ? `Lançamentos conferidos por conta; o erro do log da TPM44 na operação ${opGL.codigo} foi levado à conciliação TRM × FI-GL (conta ${contaCurva(opGL)}).`
          : "Lançamentos da TBB1, TPM44 e TPM1 conferidos por conta no razão, sem erros nos logs.";
        break;
      case "tpm1":
        if (fx.length && Math.abs(somaItens(fx)) > TOLERANCIA) {
          status = "Com ressalva";
          nota = `Variação cambial do último dia útil dos time deposits (${fmtDifBRL(-somaItens(fx))}) lançada em D+1 – item de conciliação da conta 1.1.2.04.`;
        }
        break;
      case "gl":
        if (glPend.length) {
          status = "Com ressalva";
          nota = `${plural(glPend.length, "diferença pendente", "diferenças pendentes")} (${fmtDifBRL(glPend.reduce((s, l) => s + l.diferenca, 0))}).`;
        } else if (glExp.length) nota = `${plural(glExp.length, "diferença temporária explicada", "diferenças temporárias explicadas")}.`;
        break;
      case "extratos":
        if (extPend.length) {
          status = "Com ressalva";
          nota = `${plural(extPend.length, "extrato com diferença pendente", "extratos com diferença pendente")} (${extPend.map((l) => l.c.codigo).join(", ")}).`;
        } else if (extExp.length) {
          const nTemp = extExp.filter((l) => l.itens.some((i) => i.natureza === "timing")).length;
          const nPreco = extExp.length - nTemp;
          const partes = [nTemp ? `${nTemp} ${nTemp === 1 ? "temporária" : "temporárias"} (timing)` : "", nPreco ? `${nPreco} de fonte de preço` : ""].filter(Boolean);
          nota = `${plural(extExp.length, "diferença explicada", "diferenças explicadas")}: ${partes.join(" e ")}.`;
        }
        break;
      case "rollforward":
        if (checagensFalha.length) {
          status = "Com ressalva";
          nota = `${plural(checagensFalha.length, "checagem com falha", "checagens com falha")}.`;
        } else nota = `Diferença de R$ 0,00 · ${checagens.length} checagens OK.`;
        break;
      case "aprovacao":
        if (qtdPendencias) {
          status = "Pendente";
          nota = `Aguarda a regularização de ${plural(qtdPendencias, "pendência", "pendências")}.`;
        } else nota = "Período aprovado; saldos enviados para a nota explicativa.";
        break;
    }
    return { ...e, data: diaUtil(db, e.du), status, nota };
  });

  // ------------------------------------------------------------------ Resumos
  const contas = [...new Set(gl.map((l) => l.conta.conta))].map((conta) => {
    const ls = gl.filter((l) => l.conta.conta === conta);
    const status: StatusConc = ls.some((l) => l.status === "Pendente")
      ? "Pendente"
      : ls.some((l) => l.status === "Diferença explicada")
        ? "Diferença explicada"
        : "Conciliado";
    return { conta, status };
  });

  const planoResumo = PLANO_CONTAS.map((conta) => {
    const ls = gl.filter((l) => l.conta.conta === conta.conta);
    return {
      conta,
      contratos: ls.reduce((s, l) => s + l.contratos, 0),
      tipos: ls.map((l) => l.tipo),
      saldoTRM: r2(ls.reduce((s, l) => s + l.saldoTRM, 0)),
      saldoGL: r2(ls.reduce((s, l) => s + l.saldoGL, 0)),
    };
  });

  // totais do TRM × FI-GL = somas das linhas (já arredondadas a centavos)
  const totalGL = {
    saldoTRM: r2(gl.reduce((s, l) => s + l.saldoTRM, 0)),
    saldoGL: r2(gl.reduce((s, l) => s + l.saldoGL, 0)),
    diferenca: r2(gl.reduce((s, l) => s + l.diferenca, 0)),
  };
  /** valor contábil da Carteira-Mestre (soma sem arredondamento por linha) − total das linhas do TRM × FI-GL */
  const arredondamentoCarteira = r2(r2(valorContabil) - totalGL.saldoTRM);

  const naturezas = (["timing", "pendente"] as Natureza[]).map((n) => {
    const xs = gl.flatMap((l) => l.itens.filter((i) => i.natureza === n));
    return { natureza: n, qtd: xs.length, valor: r2(somaItens(xs)) };
  });
  const arredondamentoGL = r2(gl.reduce((s, l) => s + l.arredondamento, 0));
  const linhasArredondamento = gl.filter((l) => Math.abs(l.arredondamento) >= 0.005).length;

  return {
    inicio,
    emAndamento,
    du0,
    duM1,
    du1,
    contratos,
    mov,
    gl,
    contas,
    planoResumo,
    naturezas,
    arredondamentoGL,
    linhasArredondamento,
    totalGL,
    arredondamentoCarteira,
    extratos,
    porTipo,
    saldoCarteira,
    saldoAnterior,
    valorContabil,
    circulante,
    mtmVJORA,
    mtmVJR,
    mtmCusto,
    rollforwardOk,
    difIdentidade,
    difSaldoFinal,
    checagens,
    checklist,
    glPend,
    glExp,
    extPend,
    extExp,
    checagensFalha,
    qtdPendencias,
    pendencias,
  };
}

export type Conciliacao = ReturnType<typeof montarConciliacao>;

const cacheConciliacao = new Map<string, Conciliacao>();

/** Conciliação do mês da data-base (memorizada por data-base, escopo e premissas) */
export function conciliacaoDoMes(dataBase: string, p: PremissasMercado, escopo: Escopo = "todas"): Conciliacao {
  const k = `${dataBase}|${escopo}|${chavePremissas(p)}`;
  let r = cacheConciliacao.get(k);
  if (!r) {
    r = montarConciliacao(dataBase, p, escopo);
    cacheConciliacao.set(k, r);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Resumo para o Launchpad e a central de alertas
// ---------------------------------------------------------------------------

export interface ResumoConciliacao {
  /** contas contábeis com saldo (TRM × FI-GL) */
  contas: number;
  /** contas sem diferença pendente (inclui as com diferença explicada) */
  contasConciliadas: number;
  extratos: number;
  /** extratos sem diferença pendente (inclui os com diferença explicada) */
  extratosConciliados: number;
  /** diferenças "Pendente" do TRM × FI-GL e dos extratos (bloqueiam a aprovação) */
  pendencias: { id: string; titulo: string; descricao: string; valor: number }[];
  etapas: number;
  /** etapas do checklist executadas (concluídas ou com ressalva) */
  etapasConcluidas: number;
  aprovada: boolean;
  /** maior diferença absoluta do roll-forward (identidade e saldo final × Carteira-Mestre), em R$ */
  diferencaRollforward: number;
}

const cacheResumo = new Map<string, ResumoConciliacao>();

export function resumoConciliacao(dataBase: string, p: PremissasMercado, escopo: Escopo = "todas"): ResumoConciliacao {
  const k = `${dataBase}|${escopo}|${chavePremissas(p)}`;
  const hit = cacheResumo.get(k);
  if (hit) return hit;
  const d = conciliacaoDoMes(dataBase, p, escopo);
  const r: ResumoConciliacao = {
    contas: d.contas.length,
    contasConciliadas: d.contas.filter((c) => c.status !== "Pendente").length,
    extratos: d.extratos.length,
    extratosConciliados: d.extratos.length - d.extPend.length,
    pendencias: d.pendencias.map(({ id, titulo, descricao, valor }) => ({ id, titulo, descricao, valor })),
    etapas: d.checklist.length,
    etapasConcluidas: d.checklist.filter((e) => e.status !== "Pendente").length,
    aprovada: d.checklist.find((e) => e.id === "aprovacao")?.status === "Concluída",
    diferencaRollforward: Math.max(d.difIdentidade, Math.abs(d.difSaldoFinal)),
  };
  cacheResumo.set(k, r);
  return r;
}
